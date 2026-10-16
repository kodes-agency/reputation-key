// A goal reached, or ended by something other than a manager, told on the Goals
// page for a while after it happened (`recentOutcome`): the snapshot consumer
// usually reaches a goal before anyone looks, so the news comes from History as
// often as from the read that found it. It says what happened, on which day,
// and offers what comes next: after reaching, "Set your next goal" (the setup,
// opened on its recommendation), "Keep 4.7" beside it at 4.7 or 4.8 (X1: the
// next tenth needs new reviews of nearly five stars), or only "Keep 4.9" at 4.9
// or 5.0, where no higher tenth can be planned (R2-9); after an end it did not
// choose, a new goal (ADR 0067, decision 6).
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { StatusBadge } from '#/components/ui/status-badge'
import { formatShortDate } from '#/lib/format'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { RatingGoalCardHeader } from './rating-goal-card'
import { endedSentence, ratingText, type RatingGoalOutcomeView } from './rating-goal-view'
import type { RatingGoalWizardIntent } from './rating-goal-wizard-view'

/** The highest tenth a goal can climb to (4.9): there is no "next" past it, only Keep. */
const HIGHEST_TENTHS = 49
/** Keep is offered from 4.7 (X1; Reporting's `offerKeepFirst`). */
const KEEP_OFFERED_FROM_TENTHS = 47

type Props = Readonly<{
  outcome: RatingGoalOutcomeView
  /** What Google shows now, when the setup has read it: it may have moved since. */
  googleShowsNow: number | null
  /** False when the Property cannot have a goal now (archived, too few reviews). */
  canSetNext: boolean
  timezone: string
  now: Date
  onStart: (intent: RatingGoalWizardIntent) => void
}>

const OUTCOME = {
  reached: { label: 'Reached', tone: 'positive' },
  ended: { label: 'Ended', tone: 'neutral' },
} as const

/** "Google shows 4.5 — goal reached on Oct 12", or what it shows now if it slipped since. */
function reachedSentence(
  outcome: RatingGoalOutcomeView,
  googleShowsNow: number | null,
  day: string | null,
): string {
  const target = ratingText(outcome.target)
  const on = day === null ? '' : ` on ${day}`
  if (googleShowsNow === null || googleShowsNow >= outcome.target) {
    return `Google shows ${target} — goal reached${on}`
  }
  return `Goal reached${on}: Google showed ${target}. It shows ${ratingText(googleShowsNow)} now.`
}

function NextSteps({ outcome, onStart }: Pick<Props, 'outcome' | 'onStart'>) {
  const { targetTenths } = outcome
  if (outcome.state === 'ended') {
    return <Button onClick={() => onStart({ kind: 'climb' })}>Set a new goal</Button>
  }
  const next = (
    <Button onClick={() => onStart({ kind: 'climb' })}>Set your next goal</Button>
  )
  const keep = (
    <Button variant="outline" onClick={() => onStart({ kind: 'keep', targetTenths })}>
      {`Keep ${ratingText(outcome.target)}`}
    </Button>
  )
  if (targetTenths < KEEP_OFFERED_FROM_TENTHS) return next
  if (targetTenths >= HIGHEST_TENTHS) return keep
  return (
    <>
      {next}
      {keep}
    </>
  )
}

export function RatingGoalOutcome({
  outcome,
  googleShowsNow,
  canSetNext,
  timezone,
  now,
  onStart,
}: Props) {
  const { can } = usePermissions()
  const day = formatShortDate(outcome.at, timezone, now)
  return (
    <Card data-slot="rating-goal-outcome" className="gap-4">
      <RatingGoalCardHeader>
        <StatusBadge {...OUTCOME[outcome.state]} />
      </RatingGoalCardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-lg font-semibold">
          {outcome.state === 'reached'
            ? reachedSentence(outcome, googleShowsNow, day)
            : `${endedSentence(outcome.endedReason)}. Your goal was ${ratingText(outcome.target)} on Google.`}
        </p>
        {can('goal.create') && canSetNext ? (
          <div className="flex flex-wrap gap-2">
            <NextSteps outcome={outcome} onStart={onStart} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
