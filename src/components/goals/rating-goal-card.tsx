// The Property's Google rating goal as a simple card: what Google shows and the
// goal, one bar, one pace line, one forecast and the way to the detail. Nothing
// else: the owner found the full tracking card "super overwhelming" for a new
// user, so detail is one click away (ADR 0067, decision 7). The Goals page draws
// it first; the Property Overview draws the same card.
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { InlineLink } from '#/components/ui/inline-link'
import { ProgressBar } from '#/components/ui/progress-bar'
import { StatusBadge } from '#/components/ui/status-badge'
import {
  cardOutlook,
  cardPaceLine,
  exactProgressText,
  googleShows,
  RATING_GOAL_STATUS,
  ratingText,
} from './rating-goal-view'

/** The bar counts in thousandths of the way from the start to the threshold. */
const BAR_STEPS = 1000

/** The figure a headline leads with: large, its words around it small. */
const FIGURE = 'text-3xl leading-none font-semibold tabular-nums'
const QUIET = 'text-sm text-muted-foreground'

type Props = Readonly<{
  card: RatingGoalCardView
  propertyId: string
  /** The Property's zone: a stale number's date and the waiting sentence are on its clock. */
  timezone: string
  now: Date
}>

/** "Google shows 4.3 → your goal 4.5": the two numbers the card leads with. */
export function RatingGoalHeadline({ card, timezone, now }: Omit<Props, 'propertyId'>) {
  const shows = googleShows(card.google, timezone, now)
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className={QUIET}>Google shows</span>
      <span className={FIGURE}>{shows.figure}</span>
      {shows.asOf === null ? null : <span className={QUIET}>{shows.asOf}</span>}
      {card.mode === 'keep' ? null : (
        <>
          <span className={QUIET}>
            <span aria-hidden="true">→ </span>your goal
          </span>
          <span className={FIGURE}>{ratingText(card.target)}</span>
        </>
      )}
    </p>
  )
}

export function RatingGoalCard({ card, propertyId, timezone, now }: Props) {
  const pace = cardPaceLine(card)
  const outlook = cardOutlook(card, timezone)
  const target = ratingText(card.target)
  return (
    <Card data-slot="rating-goal-card" className="gap-4">
      <CardHeader>
        <CardTitle as="h2">Google rating goal</CardTitle>
        <CardAction>
          <StatusBadge status={card.status} map={RATING_GOAL_STATUS} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {card.mode === 'keep' ? (
          <p className="text-lg font-semibold">Keeping {target} on Google</p>
        ) : null}
        <RatingGoalHeadline card={card} timezone={timezone} now={now} />
        {card.progress === null ? null : (
          <ProgressBar
            className="max-w-md"
            value={Math.round(card.progress * BAR_STEPS)}
            max={BAR_STEPS}
            label={`Progress toward Google showing ${target}`}
            valueText={`Exact average ${exactProgressText(card.exactAverage, card.threshold)}`}
          />
        )}
        {pace === null ? null : <p className="text-sm">{pace}</p>}
        {outlook === null ? null : <p className={QUIET}>{outlook}</p>}
      </CardContent>
      <CardFooter>
        <InlineLink
          to="/properties/$propertyId/goals/google-rating"
          params={{ propertyId }}
        >
          View details
        </InlineLink>
      </CardFooter>
    </Card>
  )
}
