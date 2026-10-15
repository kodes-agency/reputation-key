// The Property's Google rating goal as a simple card: what Google shows and the
// goal, one bar, one pace line, one forecast and the way to the detail. Nothing
// else: the owner found the full tracking card "super overwhelming" for a new
// user, so detail is one click away (ADR 0067, decision 7). The Goals page draws
// it first; the Property Overview draws the same card.
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { ProgressBar } from '#/components/ui/progress-bar'
import { StatusBadge } from '#/components/ui/status-badge'
import {
  averageProgressText,
  cardOutlook,
  cardPaceLine,
  googleShows,
  ratingGoalStatusBadge,
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

/**
 * The id of the section's heading, wherever the section draws it: the wizard
 * hands the focus back to it when the button that opened it is gone (the empty
 * state's "Set goal" turns into the card once the goal is set).
 */
export const RATING_GOAL_HEADING_ID = 'google-rating-goal-title'

/**
 * "Google rating goal" and its one chip. The chip drops below the title when the
 * card is too narrow for both, rather than squeezing the title onto two lines.
 */
export function RatingGoalCardHeader({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <CardHeader className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <CardTitle
        as="h2"
        id={RATING_GOAL_HEADING_ID}
        tabIndex={-1}
        className="whitespace-nowrap outline-none"
      >
        Google rating goal
      </CardTitle>
      {children}
    </CardHeader>
  )
}

/** Words and their figure, kept on one line together. */
const GROUP = 'inline-flex items-baseline gap-2 whitespace-nowrap'

/**
 * "Google shows 4.3 → your goal 4.5": the two numbers the card leads with. Each
 * number stays with its words, and the arrow with the first, so a narrow card
 * breaks the line after "→", never before it. A stale number's date sits under
 * them.
 */
export function RatingGoalHeadline({ card, timezone, now }: Omit<Props, 'propertyId'>) {
  const shows = googleShows(card.google, timezone, now)
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={GROUP}>
          <span className={QUIET}>Google shows</span>
          <span className={FIGURE}>{shows.figure}</span>
          {card.mode === 'keep' ? null : (
            <span aria-hidden="true" className={QUIET}>
              →
            </span>
          )}
        </span>
        {card.mode === 'keep' ? null : (
          <span className={GROUP}>
            <span className={QUIET}>your goal</span>
            <span className={FIGURE}>{ratingText(card.target)}</span>
          </span>
        )}
      </p>
      {shows.asOf === null ? null : <p className={QUIET}>{shows.asOf}</p>}
    </div>
  )
}

export function RatingGoalCard({ card, propertyId, timezone, now }: Props) {
  const pace = cardPaceLine(card)
  const outlook = cardOutlook(card, timezone, now)
  const target = ratingText(card.target)
  return (
    <Card data-slot="rating-goal-card" className="gap-4">
      <RatingGoalCardHeader>
        <StatusBadge {...ratingGoalStatusBadge(card)} />
      </RatingGoalCardHeader>
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
            valueText={averageProgressText(card)}
          />
        )}
        {pace === null ? null : <p className="text-sm">{pace}</p>}
        {outlook === null ? null : <p className={QUIET}>{outlook}</p>}
      </CardContent>
      <CardFooter>
        {/* The card's one way on: a tap target on a phone, not a link in a sentence. */}
        <Button asChild variant="link" className="px-0 has-[>svg]:px-0">
          <Link to="/properties/$propertyId/goals/google-rating" params={{ propertyId }}>
            View details
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
