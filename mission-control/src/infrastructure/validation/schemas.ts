/**
 * Validation Schemas (Task 37, Task 23)
 *
 * Uses Zod for runtime validation with full TypeScript inference.
 * Validates mission submissions to ensure data integrity and security.
 *
 * Validation Layers:
 * 1. Schema validation (Zod): Required fields, types, formats
 * 2. Allowlist validation (Task 23): Approved rover commands only
 * 3. Length/size limits: Prevent resource exhaustion
 *
 * User Story 21 Integration:
 * - Code validation includes allowlist check
 * - Blocks disallowed imports (os, sys, subprocess, etc.)
 * - Only permits approved rover commands
 */

import { z } from 'zod';
import type { CreateMissionDto } from '@/core/application/dto/mission';
import { AllowlistService } from '@/core/application/services/AllowlistService';
import { calculatePythonDuration } from '@/core/domain/safety/calculateMissionDuration';
import { MISSION_TIME_LIMIT_SECONDS } from '@/core/domain/safety/limits';
import { isGeneratedMissionName } from '@/core/domain/services/missionNameGenerator';

/**
 * Schema for creating a new mission (anonymous submission)
 * Maps to POST /api/missions request body
 */
export const createMissionSchema = z.object({
  yardId: z
    .string()
    .min(1, 'Yard ID is required')
    .max(50, 'Yard ID too long')
    .regex(/^[a-zA-Z0-9-_]+$/, 'Yard ID must contain only alphanumeric characters, hyphens, and underscores'),

  learnerId: z
    .string()
    .min(1, 'Learner ID is required')
    .max(100, 'Learner ID too long'),

  /**
   * nanoid(21), which is what anonymous-auth actually mints. Nothing renders
   * this, so it is not a channel anyone would read, but it does land on a
   * world-readable document and a free-form string field there is a loose end
   * rather than a feature.
   */
  sessionId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, 'Session ID has an unexpected format'),

  learnerEmail: z
    .string()
    .email('Invalid email address')
    .max(254, 'Email too long')
    .optional(),

  /**
   * The name must be one the generator could have produced (AB#402).
   *
   * This is the boundary, not the input control. The browser has shown a
   * read-only name with a re-roll button for a while, but the API accepted any
   * string up to 100 characters, so anyone posting directly could put whatever
   * they liked on a world-readable document. 47 of the first 400 missions
   * carry names the generator could never have made.
   *
   * A closed vocabulary rather than a filter of bad words: a blocklist is an
   * endless argument with the person trying to get past it, while a list of
   * permitted pairings has nothing to argue with.
   */
  name: z
    .string()
    .refine(isGeneratedMissionName, 'Mission names are generated, not typed'),

  code: z
    .string()
    .min(1, 'Code cannot be empty')
    .max(10000, 'Code exceeds maximum length of 10,000 characters')
    .refine((code) => code.trim().length > 0, {
      message: 'Code cannot be only whitespace',
    }),

  blocklyState: z.string().optional(),

  origin: z.literal('challenge').optional(),
  challengeId: z.string().max(100, 'Challenge ID too long').optional(),
}) satisfies z.ZodType<CreateMissionDto>;

/**
 * The DTO lives in core (application/dto/mission). Re-exported here so the
 * many existing importers keep working, and asserted against below so the
 * schema cannot drift from the contract without a compile error.
 */
export type { CreateMissionDto, UpdateMissionDto } from '@/core/application/dto/mission';

/**
 * Schema for mission status updates
 * Used by operator console and execution agent
 */
export const updateMissionSchema = z.object({
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']).optional(),

  executionResult: z.object({
    isSuccessful: z.boolean(),
    consoleOutput: z.string(),
    errorMessage: z.string().optional(),
  }).optional(),

  videoUrl: z.string().url().optional(),
  youtubeUrl: z.string().url().optional(),

  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
}).strict();


/**
 * Validation helper that returns formatted error messages
 *
 * Performs three-phase validation:
 * 1. Schema validation (Zod)
 * 2. Allowlist validation (User Story 21)
 * 3. Mission time limit validation (AB#401)
 *
 * There is deliberately no speed phase here. ROVER_ARGUMENT_LIMITS already
 * caps every motion command at 0-100 in phase 2, with a message that names the
 * line and suggests a value, and phase 2 returns before anything after it can
 * run. A second speed check at this layer could never fire. The rover keeps
 * its own copy in mission_validator.py, which is a different matter: nothing
 * on the yard enforces the allowlist, so that one is the only guard on the
 * LAN boundary.
 *
 * @param data - Mission submission data
 * @returns Validation result with errors if any
 */
export function validateMission(data: unknown): {
  success: boolean;
  data?: CreateMissionDto;
  errors?: string[];
} {
  // Phase 1: Schema validation (required fields, types, formats)
  const result = createMissionSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.errors.map((err) => {
      const path = err.path.join('.');
      return `${path}: ${err.message}`;
    });

    return { success: false, errors };
  }

  // Phase 2: Allowlist validation (User Story 21, Task 23)
  // Check code against approved rover commands
  const allowlistService = new AllowlistService();
  const allowlistResult = allowlistService.analyze(result.data.code);

  if (!allowlistResult.isValid) {
    // If analysis error occurred
    if (allowlistResult.error) {
      return {
        success: false,
        errors: [`code: ${allowlistResult.error}`],
      };
    }

    // Convert allowlist findings to error messages
    const allowlistErrors = allowlistResult.findings.map((finding) => {
      const location = finding.line ? ` (line ${finding.line})` : '';
      return `code${location}: ${finding.message}`;
    });

    return { success: false, errors: allowlistErrors };
  }

  // Phase 3: mission time limit (AB#401). The allowlist caps a single sleep at
  // 60 seconds but never adds them up, so a loop is how a mission gets long.
  const duration = calculatePythonDuration(result.data.code);
  if (duration > MISSION_TIME_LIMIT_SECONDS) {
    return {
      success: false,
      errors: [
        `code: This mission runs for about ${Math.round(duration)} seconds, and a mission ` +
          `cannot be longer than ${MISSION_TIME_LIMIT_SECONDS}. Shorten a drive, or repeat ` +
          `it fewer times.`,
      ],
    };
  }

  // All validations passed
  return { success: true, data: result.data };
}
