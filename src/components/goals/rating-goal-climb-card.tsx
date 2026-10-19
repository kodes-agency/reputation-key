// A Google rating goal that climbs, as its card on the Goals page and the
// Property Overview (round 5, PLAN-D D-1, mocks D2 and D4): the ladder of
// numbers, the new reviews to the next number Google can show with a square
// for each, when the goal arrives, this week against the plan, the first step
// once taken, and the way to the detail and the Portals. The card is its own
// container, so a narrow slot draws the phone layout at any screen width: D4's
// short card (the ladder, the headline, the squares, one line for this week
// and when, one link); the pace, the likely range, what is possible after the
// goal, the week's bar, the first step and the Portals are on the wide card.
import { Link } from '@tanstack/react-router'
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  arrivalSentence,
  possibleSentence,
  shortArrival,
} from './rating-goal-arrival-words'
import { GoalCardActions, GoalCardColumns, GoalCardFrame } from './goal-card-frame'
import { RATING_GOAL_HEADING_ID, RATING_GOAL_TITLE } from './rating-goal-card-header'
import { RatingGoalClimbHeadline } from './rating-goal-climb-headline'
import { PLAN_POLICY_LINE } from './rating-goal-copy'
import { RatingGoalLadder } from './rating-goal-ladder'
import { RatingGoalSlots } from './rating-goal-slots'
import { RatingGoalThisWeek } from './rating-goal-this-week'
import {
  firstStepText,
  goalLineText,
  narrowWeekLine,
  rungsOf,
  slotCount,
  soonText,
} from './rating-goal-tracking-words'
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
/** Drawn only on a card at least 48rem wide (D2); a narrower one is D4's short card. */
const WIDE_ONLY = 'hidden @3xl:block'

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

/**
 * The climb in words: the headline with its squares under it, what is coming
 * soon, the goal and when. A time the narrow card's one line gives is drawn
 * in full only on the wide card; why there is no time is said at every width.
 */
function Climb({ card }: Pick<Props, 'card'>) {
  const soon = soonText(card)
  const goal = goalLineText(card)
  const arrival = card.googleShowsSoon
    ? null
    : arrivalSentence(card, assumedAverageWords(card))
  const possible = possibleSentence(card)
  return (
    <>
      <RatingGoalClimbHeadline card={card} />
      <RatingGoalSlots count={slotCount(card)} />
      {soon === null ? null : <p className="text-sm">{soon}</p>}
      {goal === null ? null : <p className={QUIET}>{goal}</p>}
      {arrival === null ? null : (
        <p className={cn(QUIET, shortArrival(card) !== null && WIDE_ONLY)}>{arrival}</p>
      )}
      {possible === null ? null : <p className={cn(QUIET, WIDE_ONLY)}>{possible}</p>}
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

/** The card's ways on: tap targets on a phone, not links in a sentence. */
function Links({ propertyId }: Pick<Props, 'propertyId'>) {
  const { can } = usePermissions()
  return (
    <GoalCardActions>
      <Button asChild variant="outline">
        <Link to="/properties/$propertyId/goals/google-rating" params={{ propertyId }}>
          View details
        </Link>
      </Button>
      {can('portal.read') ? (
        <Button asChild variant="ghost" className="hidden @3xl:flex">
          <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
            Open Portals
          </Link>
        </Button>
      ) : null}
    </GoalCardActions>
  )
}

export function RatingGoalClimbCard({ card, propertyId, timezone, now }: Props) {
  const rungs = rungsOf(card)
  const current = card.google?.current !== false
  const firstStep = firstStepText(card)
  const narrow = narrowWeekLine(card)
  return (
    <GoalCardFrame
      slot="rating-goal-card"
      title={RATING_GOAL_TITLE}
      titleId={RATING_GOAL_HEADING_ID}
      status={ratingGoalStatusBadge(card)}
      container
    >
      <GoalCardColumns
        wide={rungs.length > 0}
        signature={
          <RatingGoalLadder rungs={rungs} orientation="upright" current={current} />
        }
        story={
          <>
            <RatingGoalLadder rungs={rungs} orientation="across" current={current} />
            <Story card={card} timezone={timezone} now={now} />
          </>
        }
        side={
          <>
            <RatingGoalThisWeek card={card} />
            {narrow === null ? null : <p className="text-sm @3xl:hidden">{narrow}</p>}
            {firstStep === null ? null : (
              <div className={WIDE_ONLY}>
                <Alert variant="success">
                  <AlertDescription>{firstStep}</AlertDescription>
                </Alert>
              </div>
            )}
            <Links propertyId={propertyId} />
          </>
        }
      />
    </GoalCardFrame>
  )
}
