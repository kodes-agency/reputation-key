// A Google rating goal that climbs, as its card on the Goals page and the
// Property Overview (round 5, PLAN-D D-1, mocks D2 and D4): the ladder of
// numbers, the new reviews to the next number Google can show with a square
// for each, when the goal arrives, this week against the plan, the first step
// once taken, and the way to the detail and the Portals. The card is its own
// container, so a narrow slot draws the phone layout at any screen width.
import { Link } from '@tanstack/react-router'
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { StatusBadge } from '#/components/ui/status-badge'
import { cn } from '#/lib/utils'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { arrivalSentence, possibleSentence } from './rating-goal-arrival-words'
import { RatingGoalCardHeader } from './rating-goal-card-header'
import { PLAN_POLICY_LINE } from './rating-goal-copy'
import { RatingGoalLadder } from './rating-goal-ladder'
import { RatingGoalSlots } from './rating-goal-slots'
import { RatingGoalThisWeek } from './rating-goal-this-week'
import {
  firstStepText,
  goalLineText,
  headlineOf,
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

/** "18 new reviews to 4.1", the figure large; or "Google should show 4.1 soon". */
function Headline({ card }: Pick<Props, 'card'>) {
  const headline = headlineOf(card)
  if (headline === null) return null
  if (headline.kind === 'soon') {
    return <p className="text-2xl font-semibold">{headline.text}</p>
  }
  return (
    <p className="text-3xl leading-tight font-semibold">
      <span className="tabular-nums">{headline.count}</span> {headline.words}{' '}
      <span className="text-primary tabular-nums">{headline.target}</span>
    </p>
  )
}

/** Stale numbers: the headline as of their day, and why the goal waits. */
function Waiting({ card, timezone, now }: Omit<Props, 'propertyId'>) {
  const asOf = googleShows(card.google, timezone, now).asOf
  return (
    <>
      <Headline card={card} />
      {asOf === null ? null : <p className={QUIET}>{asOf}</p>}
      <p className={QUIET}>{waitingSentence(card.google, timezone, now)}</p>
    </>
  )
}

/** The climb in words: the headline, what is coming soon, the goal, the squares and when. */
function Climb({ card }: Pick<Props, 'card'>) {
  const soon = soonText(card)
  const goal = goalLineText(card)
  const arrival = card.googleShowsSoon
    ? null
    : arrivalSentence(card, assumedAverageWords(card))
  const possible = possibleSentence(card)
  return (
    <>
      <Headline card={card} />
      {soon === null ? null : <p className="text-sm">{soon}</p>}
      {goal === null ? null : <p className={QUIET}>{goal}</p>}
      <RatingGoalSlots count={slotCount(card)} />
      {arrival === null ? null : <p className={QUIET}>{arrival}</p>}
      {possible === null ? null : <p className={QUIET}>{possible}</p>}
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
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline">
        <Link to="/properties/$propertyId/goals/google-rating" params={{ propertyId }}>
          View details
        </Link>
      </Button>
      {can('portal.read') ? (
        <Button asChild variant="ghost">
          <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
            Open Portals
          </Link>
        </Button>
      ) : null}
    </div>
  )
}

export function RatingGoalClimbCard({ card, propertyId, timezone, now }: Props) {
  const rungs = rungsOf(card)
  const firstStep = firstStepText(card)
  return (
    <Card data-slot="rating-goal-card" className="@container gap-4">
      <RatingGoalCardHeader>
        <StatusBadge {...ratingGoalStatusBadge(card)} />
      </RatingGoalCardHeader>
      <CardContent
        className={cn(
          'grid gap-5',
          rungs.length > 0 && '@3xl:grid-cols-[14rem_minmax(0,1fr)]',
        )}
      >
        <RatingGoalLadder rungs={rungs} orientation="upright" />
        <div className="grid gap-5 @2xl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-3">
            <RatingGoalLadder rungs={rungs} orientation="across" />
            <Story card={card} timezone={timezone} now={now} />
          </div>
          <div className="flex min-w-0 flex-col gap-4 @2xl:border-l @2xl:pl-6">
            <RatingGoalThisWeek card={card} />
            {firstStep === null ? null : (
              <Alert variant="success">
                <AlertDescription>{firstStep}</AlertDescription>
              </Alert>
            )}
            <Links propertyId={propertyId} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
