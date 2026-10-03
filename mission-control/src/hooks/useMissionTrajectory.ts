'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Mission } from '@/core/domain/entities/Mission';
import { loadBlockly } from '@/infrastructure/browser/loadBlockly';
import { parseRoverCode } from '@/lib/parseRoverCode';
import { defineRoverBlocks, migrateSpinBlocks, workspaceToCommands } from '@/lib/roverBlockly';
import { simulateCommands, type TrajectoryPoint } from '@/lib/simulateCommands';

/**
 * A stored mission, simulated, knowing which part of the program each moment
 * came from (AB#450).
 *
 * Simulating the saved Python is enough to draw the run, and is what the page
 * did, but Python only knows line numbers. A mission built with blocks is SHOWN
 * as blocks, and lighting the running block needs block ids, which only the
 * blocks themselves carry. So a block mission is simulated a second time from
 * its blocks, in a headless Blockly workspace (no DOM, never shown), once
 * Blockly has loaded. Until then, and for Python missions, the Python result
 * stands. The two describe the same program: the Python was generated from
 * these blocks when the mission was sent.
 */
export function useMissionTrajectory(mission: Mission | null): TrajectoryPoint[] {
  const fromPython = useMemo(() => (mission ? simulateCommands(parseRoverCode(mission.code)) : []), [mission]);
  const [fromBlocks, setFromBlocks] = useState<{ state: string; trajectory: TrajectoryPoint[] } | null>(null);
  const state = mission?.blocklyState ?? null;

  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    loadBlockly()
      .then(() => {
        if (cancelled || !window.Blockly) return;
        const Blockly = window.Blockly;
        defineRoverBlocks(Blockly);
        const workspace = new Blockly.Workspace();
        try {
          Blockly.serialization.workspaces.load(JSON.parse(migrateSpinBlocks(state)), workspace);
          const commands = workspaceToCommands(workspace);
          if (!cancelled && commands.length > 0) setFromBlocks({ state, trajectory: simulateCommands(commands) });
        } catch {
          // A workspace that will not load still has its Python; keep that.
        } finally {
          workspace.dispose();
        }
      })
      .catch(() => {
        // Blockly could not load: the Python simulation is already showing.
      });
    return () => {
      cancelled = true;
    };
  }, [state]);

  // Keyed on the state it was built from, so another mission's blocks can
  // never be served for this one.
  return fromBlocks && fromBlocks.state === state ? fromBlocks.trajectory : fromPython;
}
