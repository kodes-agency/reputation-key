// A goal that the read just found reached or ended. The read returns it this
// once, then it sits in History, so the card says what happened and offers
// what comes next: after reaching, the next tenth (preselected in the wizard)
// or "Keep 4.5"; after an end it did not choose, a new goal (ADR 0067).
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { StatusBadge } from '#/components/ui/status-badge'
import { formatShortDate } from '#/lib/format'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { endedSentence, ratingText } from './rating-goal-view'
import type { RatingGoalWizardIntent } from './rating-goal-wizard-view'

/** The highest tenth a goal can climb to (4.9): there is no "next" past it. */
const HIGHEST_TENTHS = 49

type Props = Readonly<{
  card: RatingGoalCardView
  /** When the read that found it was made: the day it was reached or ended. */
  readAt: Date
  timezone: string
  now: Date
  onStart: (intent: RatingGoalWizardIntent) => void
}>

const OUTCOME = {
  reached: { label: 'Reached', tone: 'positive' },
  ended: { label: 'Ended', tone: 'neutral' },
} as const

export function RatingGoalOutcome({ card, readAt, timezone, now, onStart }: Props) {
  const { can } = usePermissions()
  const canSet = can('goal.create')
  const target = ratingText(card.target)
  const day = formatShortDate(readAt, timezone, now)
  const reached = card.state === 'reached'
  return (
    <Card data-slot="rating-goal-outcome" className="gap-4">
      <CardHeader>
        <CardTitle as="h2">Google rating goal</CardTitle>
        <CardAction>
          <StatusBadge {...OUTCOME[reached ? 'reached' : 'ended']} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {reached ? (
          <p className="text-lg font-semibold">
            Google shows {target} — goal reached{day === null ? '' : ` on ${day}`}
          </p>
        ) : (
          <p className="text-lg font-semibold">
            {endedSentence(card.endedReason)}. Your goal was {target} on Google.
          </p>
        )}
        {canSet ? (
          <div className="flex flex-wrap gap-2">
            {reached && card.targetTenths < HIGHEST_TENTHS ? (
              <Button
                onClick={() =>
                  onStart({ kind: 'climb', preselectTenths: card.targetTenths + 1 })
                }
              >
                Set your next goal
              </Button>
            ) : null}
            {reached ? (
              <Button
                variant="outline"
                onClick={() => onStart({ kind: 'keep', targetTenths: card.targetTenths })}
              >
                {`Keep ${target}`}
              </Button>
            ) : (
              <Button onClick={() => onStart({ kind: 'climb' })}>Set a new goal</Button>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
