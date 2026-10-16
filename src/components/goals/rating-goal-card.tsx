// The Property's Google rating goal as a simple card: what Google shows and the
// goal, one bar, one pace line, one forecast and the way to the detail. Nothing
// else: the owner found the full tracking card "super overwhelming" for a new
// user, so detail is one click away (ADR 0067, decision 7). The Goals page draws
// it first; the Property Overview draws the same card.
import { Link } from '@tanstack/react-router'
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardFooter } from '#/components/ui/card'
import { ProgressBar } from '#/components/ui/progress-bar'
import { StatusBadge } from '#/components/ui/status-badge'
import { cardOutlook } from './rating-goal-arrival-words'
import { RatingGoalCardHeader } from './rating-goal-card-header'
import { RatingGoalHeadline } from './rating-goal-headline'
import { RatingGoalKeepCard } from './rating-goal-keep-card'
import {
  averageProgressText,
  cardPaceLine,
  ratingGoalStatusBadge,
  ratingText,
} from './rating-goal-view'

/** The bar counts in thousandths of the way from the start to the threshold. */
const BAR_STEPS = 1000

const QUIET = 'text-sm text-muted-foreground'

type Props = Readonly<{
  card: RatingGoalCardView
  propertyId: string
  /** The Property's zone: a stale number's date and the waiting sentence are on its clock. */
  timezone: string
  now: Date
}>

export function RatingGoalCard(props: Props) {
  if (props.card.mode === 'keep') return <RatingGoalKeepCard {...props} />
  return <RatingGoalClimbCard {...props} />
}

function RatingGoalClimbCard({ card, propertyId, timezone, now }: Props) {
  const pace = cardPaceLine(card)
  const outlook = cardOutlook(card, timezone, now)
  const target = ratingText(card.target)
  return (
    <Card data-slot="rating-goal-card" className="gap-4">
      <RatingGoalCardHeader>
        <StatusBadge {...ratingGoalStatusBadge(card)} />
      </RatingGoalCardHeader>
      <CardContent className="flex flex-col gap-3">
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
