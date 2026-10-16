// The Property's Google rating goal as its card, on the Goals page first and on
// the Property Overview (owner, 2026-10-14): a goal that keeps a number has its
// quiet card, a goal that climbs the round 5 card (PLAN-D D-1). Detail stays one
// click away (ADR 0067, decision 7).
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { RatingGoalClimbCard } from './rating-goal-climb-card'
import { RatingGoalKeepCard } from './rating-goal-keep-card'

type Props = Readonly<{
  card: RatingGoalCardView
  propertyId: string
  /** The Property's zone: a stale number's date and the waiting sentence are on its clock. */
  timezone: string
  now: Date
}>

export function RatingGoalCard(props: Props) {
  return props.card.mode === 'keep' ? (
    <RatingGoalKeepCard {...props} />
  ) : (
    <RatingGoalClimbCard {...props} />
  )
}
