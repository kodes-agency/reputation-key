// "Your plan, so far" on the Google rating goal's detail page (round 5, mock
// D3): the pace of the last four weeks against the plan and against the weeks
// before the goal, the new reviews' average against the plan's, and the steps
// reached and next. Three tiles, never two and one: stacked until there is
// room for all three.
import type { RatingGoalDetailView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { GoalTiles } from './goal-detail-layout'
import { planSoFarTiles } from './rating-goal-detail-view'

const HEADING_ID = 'rating-goal-plan-so-far'

export function RatingGoalPlanSoFar({
  detail,
}: Readonly<{ detail: RatingGoalDetailView }>) {
  return (
    <GoalTiles
      title="Your plan, so far"
      headingId={HEADING_ID}
      label="Your plan, so far, in numbers"
      tiles={planSoFarTiles(detail).map((tile) => ({ key: tile.label, ...tile }))}
    />
  )
}
