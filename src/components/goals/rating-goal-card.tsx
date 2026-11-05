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
