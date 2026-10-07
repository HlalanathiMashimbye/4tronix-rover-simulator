'use client';

import { RoverSimulator } from '@/components/mission/RoverSimulator';
import { useYardLayout } from '@/hooks/useYardLayout';

/**
 * Right-hand simulation column. Thin layout wrapper around RoverSimulator;
 * props are derived from it so they stay in sync automatically.
 */
type SimulationPanelProps = React.ComponentProps<typeof RoverSimulator>;

export function SimulationPanel(props: SimulationPanelProps) {
  const { layout } = useYardLayout(props.yardId);
  return (
    <div
      className="buildSim min-w-0 h-full overflow-hidden"
      // The yard's real shape, for globals.css to size this column from
      // (.buildSim). Read from the yard's layout, so a yard of another shape
      // gets a column of its shape.
      style={{ ['--yard-aspect' as string]: layout.widthCm / layout.depthCm }}
    >
      <RoverSimulator {...props} />
    </div>
  );
}
