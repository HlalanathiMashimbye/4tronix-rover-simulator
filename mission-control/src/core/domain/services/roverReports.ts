/**
 * What the rover's own queue history says has finished.
 *
 * The rover echoes `mission_id` back on every instruction in its history (the
 * run station sends it with the dispatch), and marks each one `completed` or
 * `error` when it ends. The satellite's watcher already reads exactly this to
 * stop the camera: see `finished_runs` in yard/satellite/mission_watcher.py,
 * which this mirrors.
 *
 * Mission Control cannot hear the rover itself, and the satellite has no way to
 * write to Firestore. The operator's browser is the one thing that can do both,
 * so it reads this and records the outcome. Pure, so the rule is testable
 * without a rover, a satellite or a browser.
 */

import type { MissionStatus } from '../entities/Mission';

export interface FinishedRun {
  /** The rover's id for this instruction, so one report is acted on once. */
  instructionId: string;
  missionId: string;
  outcome: 'completed' | 'error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Every finished run in a `/queue/status` response that names its mission.
 *
 * Anything malformed is skipped rather than thrown: the response crosses a
 * network from a Pi, and one odd entry must not hide the rest.
 */
export function finishedRuns(queueStatus: unknown): FinishedRun[] {
  if (!isRecord(queueStatus) || !Array.isArray(queueStatus.history)) return [];

  const runs: FinishedRun[] = [];
  for (const entry of queueStatus.history) {
    if (!isRecord(entry)) continue;
    const { status, id, params } = entry;
    if (status !== 'completed' && status !== 'error') continue;
    if (typeof id !== 'string' || !id) continue;
    const missionId = isRecord(params) ? params.mission_id : undefined;
    if (typeof missionId !== 'string' || !missionId) continue;
    runs.push({ instructionId: id, missionId, outcome: status });
  }
  return runs;
}

const STILL_OPEN: readonly MissionStatus[] = ['queued', 'processing'];

/**
 * The missions to mark complete because the rover says they finished.
 *
 * ONLY A CLEAN FINISH COMPLETES A MISSION. A run the rover could not execute is
 * over, but "completed" is a claim the learner is emailed about, and whether an
 * errored run counts is the operator's call. It stays open for them.
 *
 * Only missions still open in this yard's queue: the queue is the operator's
 * own, and a report about a mission that is already settled has nothing left
 * to say. `alreadyReported` holds instruction ids acted on before, so a report
 * the rover keeps in its history is not replayed against a later run of the
 * same mission.
 */
export function missionsTheRoverFinished(
  finished: FinishedRun[],
  queue: ReadonlyArray<{ id: string; status: MissionStatus }>,
  alreadyReported: ReadonlySet<string>,
): FinishedRun[] {
  const open = new Set(queue.filter((m) => STILL_OPEN.includes(m.status)).map((m) => m.id));
  const seen = new Set<string>();
  const result: FinishedRun[] = [];

  for (const run of finished) {
    if (run.outcome !== 'completed') continue;
    if (!open.has(run.missionId)) continue;
    if (alreadyReported.has(run.instructionId)) continue;
    // One completion per mission per pass, however many times it ran.
    if (seen.has(run.missionId)) continue;
    seen.add(run.missionId);
    result.push(run);
  }
  return result;
}
