// A Google rating goal that climbs, as its card on the Goals page and the Property
// Overview (2026-11-01, ADR 0067): what is left to the next number Google can show,
// when the goal arrives and the ruler of how far along it is; beside them this week
// against the plan and the way to the detail. A narrow card puts one under the
// other.
import { Link } from '@tanstack/react-router'
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { Button } from '#/components/ui/button'
import { arrivalSentence } from './rating-goal-arrival-words'
import { GoalCardActions, GoalCardColumns, GoalCardFrame } from './goal-card-frame'
import { GoalRuler } from './goal-ruler'
import { RATING_GOAL_HEADING_ID, RATING_GOAL_TITLE } from './rating-goal-card-header'
import { RatingGoalClimbHeadline } from './rating-goal-climb-headline'
import { PLAN_POLICY_LINE } from './rating-goal-copy'
import { ratingGoalRuler } from './rating-goal-ruler-view'
import { RatingGoalThisWeek } from './rating-goal-this-week'
import { goalLineText, soonText } from './rating-goal-tracking-words'
import {
  assumedAverageWords,
  googleShows,
  ratingGoalStatusBadge,
  reviewsTooLowSentence,
  waitingSentence,
} from './rating-goal-view'

type Props = Readonly<{
  card: RatingGoalCardView
  propertyId: string
  /** The Property's zone: a stale number's date and the waiting sentence are on its clock. */
  timezone: string
  now: Date
}>

const QUIET = 'text-sm text-muted-foreground'

/** Stale numbers: the headline as of their day, and why the goal waits. */
function Waiting({ card, timezone, now }: Omit<Props, 'propertyId'>) {
  const asOf = googleShows(card.google, timezone, now).asOf
  return (
    <>
      <RatingGoalClimbHeadline card={card} />
      {asOf === null ? null : <p className={QUIET}>{asOf}</p>}
      <p className={QUIET}>{waitingSentence(card.google, timezone, now)}</p>
    </>
  )
}

/** The climb in words: the headline, what is coming soon, the goal and when. */
function Climb({ card }: Pick<Props, 'card'>) {
  const soon = soonText(card)
  const goal = goalLineText(card)
  const arrival = card.googleShowsSoon
    ? null
    : arrivalSentence(card, assumedAverageWords(card))
  return (
    <>
      <RatingGoalClimbHeadline card={card} />
      {soon === null ? null : <p className="text-sm">{soon}</p>}
      {goal === null ? null : <p className={QUIET}>{goal}</p>}
      {arrival === null ? null : <p className={QUIET}>{arrival}</p>}
    </>
  )
}

function Story(props: Omit<Props, 'propertyId'>) {
  const { card } = props
  if (card.status === 'waiting_for_google') return <Waiting {...props} />
  if (card.status === 'reviews_too_low') {
    // What helps: the approved words on how guests are asked (R2-12).
    return (
      <p className="text-sm">
        {reviewsTooLowSentence(card.target)} {PLAN_POLICY_LINE}
      </p>
    )
  }
  return <Climb card={card} />
}

export function RatingGoalClimbCard({ card, propertyId, timezone, now }: Props) {
  const ruler = ratingGoalRuler(card)
  return (
    <GoalCardFrame
      slot="rating-goal-card"
      title={RATING_GOAL_TITLE}
      titleId={RATING_GOAL_HEADING_ID}
      status={ratingGoalStatusBadge(card)}
      container
    >
      <GoalCardColumns
        story={
          <>
            <Story card={card} timezone={timezone} now={now} />
            {ruler === null ? null : <GoalRuler model={ruler} />}
          </>
        }
        side={
          <>
            <RatingGoalThisWeek card={card} />
            <GoalCardActions>
              <Button asChild variant="outline">
                <Link
                  to="/properties/$propertyId/goals/google-rating"
                  params={{ propertyId }}
                >
                  View details
                </Link>
              </Button>
            </GoalCardActions>
          </>
        }
      />
    </GoalCardFrame>
  )
}
