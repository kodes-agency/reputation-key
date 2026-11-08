import type { RatingGoalCardView } from '#/contexts/reporting/rating-goals/contracts'
import { GoalHeadline } from '#/components/goals/goal-headline'
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
    <GoalHeadline
      count={headline.count}
      words={headline.words}
      target={headline.target}
    />
  )
}
