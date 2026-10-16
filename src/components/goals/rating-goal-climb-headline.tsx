// "18 new reviews to 4.1": the headline a climbing Google rating goal leads
// with on its card and on its detail page (round 5, PLAN-D E5), the figure
// large and the number it counts to in the link ink (V23); or "Google should
// show 4.1 soon" once the reviews have earned the goal.
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { headlineOf } from './rating-goal-tracking-words'

export function RatingGoalClimbHeadline({
  card,
}: Readonly<{ card: RatingGoalCardView }>) {
  const headline = headlineOf(card)
  if (headline === null) return null
  if (headline.kind === 'soon') {
    return <p className="text-2xl font-semibold">{headline.text}</p>
  }
  return (
    <p className="text-2xl leading-tight font-semibold">
      <span className="tabular-nums">{headline.count}</span> {headline.words}{' '}
      <span className="text-link tabular-nums">{headline.target}</span>
    </p>
  )
}
