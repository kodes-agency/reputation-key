// "Your plan, so far" on the Google rating goal's detail page (round 5, mock
// D3): the pace of the last four weeks against the plan and against the weeks
// before the goal, the new reviews' average against the plan's, and the steps
// reached and next. Three tiles, never two and one: stacked until there is
// room for all three.
import type { RatingGoalDetailView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { Metric, MetricStrip, MetricValue } from '#/components/ui/metric-strip'
import { SectionTitle } from '#/components/ui/section-title'
import { planSoFarTiles } from './rating-goal-detail-view'

const HEADING_ID = 'rating-goal-plan-so-far'

export function RatingGoalPlanSoFar({
  detail,
}: Readonly<{ detail: RatingGoalDetailView }>) {
  const tiles = planSoFarTiles(detail)
  if (tiles.length === 0) return null
  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <SectionTitle id={HEADING_ID}>Your plan, so far</SectionTitle>
      <MetricStrip
        aria-label="Your plan, so far, in numbers"
        variant="tiles"
        columns={3}
        className="@max-2xl:grid-cols-1"
      >
        {tiles.map((tile) => (
          <Metric key={tile.label} label={tile.label}>
            <MetricValue value={tile.value} detail={tile.detail} />
          </Metric>
        ))}
      </MetricStrip>
    </section>
  )
}
