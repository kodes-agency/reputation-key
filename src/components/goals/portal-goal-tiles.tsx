// The Monthly portal goal page's tiles (copy deck P-4): the month the goal is
// counting, the month before (or that it had no goal), and the usual it stands
// on. Three across from 42rem of column, two and one below that. The words are
// `portalGoalTiles`'; this only lays them out.
import type { PortalGoalTileWords } from './portal-goal-page-view'
import { Metric, MetricStrip, MetricValue } from '#/components/ui/metric-strip'
import { PORTAL_GOAL_NAME } from './portal-goal-copy'

type Props = Readonly<{ tiles: readonly PortalGoalTileWords[] }>

export function PortalGoalTiles({ tiles }: Props) {
  return (
    <MetricStrip aria-label={PORTAL_GOAL_NAME} variant="tiles" columns={3}>
      {tiles.map((tile) => (
        <Metric key={tile.key} label={tile.label}>
          <MetricValue value={tile.value} detail={tile.detail} />
        </Metric>
      ))}
    </MetricStrip>
  )
}
