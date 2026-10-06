'use client';

import { RoverSimulator } from '@/components/mission/RoverSimulator';
import { YARD } from '@/lib/rover-physics';

/**
 * Right-hand simulation column. Thin layout wrapper around RoverSimulator;
 * props are derived from it so they stay in sync automatically.
 */
type SimulationPanelProps = React.ComponentProps<typeof RoverSimulator>;

export function SimulationPanel(props: SimulationPanelProps) {
  return (
    <div
      className="buildSim min-w-0 h-full overflow-hidden"
      // The yard's real shape, for globals.css to size this column from
      // (.buildSim). Read from YARD so the measured yard stays the one owner.
      style={{ ['--yard-aspect' as string]: YARD.widthCm / YARD.depthCm }}
    >
      <RoverSimulator {...props} />
    </div>
  );
}
