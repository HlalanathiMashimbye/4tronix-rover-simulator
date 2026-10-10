/**
 * Mission Service
 *
 * Business logic layer for mission management.
 * Handles anonymous mission submission (User Story 35).
 *
 * Responsibilities:
 * - Coordinate mission creation
 * - Enforce business rules
 * - Orchestrate repository operations
 *
 * Follows Single Responsibility Principle (SOLID).
 */

import { Mission } from '@/core/domain/entities/Mission';
import { IMissionReader, IMissionWriter } from '@/core/domain/repositories/IMissionRepository';
import type { IMissionNameRegistry } from '@/core/domain/repositories/IMissionNameRegistry';
import { isNewMissionName } from '@/core/domain/services/missionNameGenerator';
import { hashLearnerEmail } from '@/core/domain/services/learnerEmailHash';
import { hashLearnerId } from '@/core/domain/services/learnerRef';
import { CreateMissionDto } from '@/core/application/dto/mission';

export interface SubmitMissionResult {
  success: boolean;
  mission?: Mission;
  error?: string;
}

export class MissionService {
  /** Reads and writes missions; never touches runs, so it is not given them. */
  constructor(
    private readonly missionRepository: IMissionReader & IMissionWriter,
    private readonly missionNames: IMissionNameRegistry,
  ) {}

  /**
   * Submit a new mission (anonymous - no authentication required)
   * Implements User Story 35 and Task 38
   *
   * @param dto - Validated mission submission data
   * @returns Result with created mission or error
   */
  async submitMission(dto: CreateMissionDto): Promise<SubmitMissionResult> {
    try {
      // The address is accepted over HTTPS but never persisted on the mission:
      // mission documents are world-readable, so only the hash is stored. The
      // address itself lives on the learner record, written by the client.
      const learnerEmailHash = dto.learnerEmail
        ? await hashLearnerEmail(dto.learnerEmail)
        : undefined;

      // Same reasoning as the address above, for the same reason: the raw
      // learner id arrives over HTTPS but is never persisted on a
      // world-readable document. Only the hash is.
      const learnerRef = await hashLearnerId(dto.learnerId);

      const name = await this.uniqueName(dto.name);

      const mission = await this.missionRepository.create({
        yardId: dto.yardId,
        learnerRef,
        sessionId: dto.sessionId,
        learnerEmailHash,
        name,
        code: dto.code,
        blocklyState: dto.blocklyState,
        origin: dto.origin,
        challengeId: dto.challengeId,
        status: 'queued',
        submittedAt: new Date().toISOString(),
      });

      return {
        success: true,
        mission,
      };
    } catch (error) {
      console.error('Failed to submit mission:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * The name the learner rolled, if it is theirs to take; otherwise the next
   * one nobody has. Either way no other mission has it (IMissionNameRegistry).
   *
   * The roll is free and made in the browser, which cannot know what other
   * missions are called, so this is the one place a clash can be settled. A
   * name of only the original words is not claimed at all: an older mission
   * may carry it, from before names were recorded.
   */
  private async uniqueName(rolled: string): Promise<string> {
    if (isNewMissionName(rolled) && (await this.missionNames.claim(rolled))) return rolled;
    return this.missionNames.takeNext();
  }

  /**
   * Get mission by ID
   *
   * @param id - Mission ID
   * @returns Mission or null if not found
   */
  async getMissionById(id: string): Promise<Mission | null> {
    return this.missionRepository.findById(id);
  }


  /**
   * Update mission status and results
   * Used by execution agent and operator console
   *
   * @param id - Mission ID
   * @param updates - Fields to update
   * @returns Updated mission or null if not found
   */
  async updateMission(id: string, updates: Partial<Mission>): Promise<Mission | null> {
    return this.missionRepository.update(id, updates);
  }
}
