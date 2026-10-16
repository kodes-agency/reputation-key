// A goal that keeps the number Google shows, as its card: "Keeping 4.9 on
// Google", Google's number (dated while it is stale), the one chip and the way
// to the detail. It has no climb, no pace and no arrival.
import { Link } from '@tanstack/react-router'
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardFooter } from '#/components/ui/card'
import { StatusBadge } from '#/components/ui/status-badge'
import { RatingGoalCardHeader } from './rating-goal-card-header'
import { RatingGoalHeadline } from './rating-goal-headline'
import { ratingGoalStatusBadge, ratingText, waitingSentence } from './rating-goal-view'

type Props = Readonly<{
  card: RatingGoalCardView
  propertyId: string
  /** The Property's zone: a stale number's date and the waiting sentence are on its clock. */
  timezone: string
  now: Date
}>

export function RatingGoalKeepCard({ card, propertyId, timezone, now }: Props) {
  const waiting = card.status === 'waiting_for_google'
  return (
    <Card data-slot="rating-goal-card" className="gap-4">
      <RatingGoalCardHeader>
        <StatusBadge {...ratingGoalStatusBadge(card)} />
      </RatingGoalCardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-lg font-semibold">
          Keeping {ratingText(card.target)} on Google
        </p>
        <RatingGoalHeadline card={card} timezone={timezone} now={now} />
        {waiting ? (
          <p className="text-sm text-muted-foreground">
            {waitingSentence(card.google, timezone, now)}
          </p>
        ) : null}
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
