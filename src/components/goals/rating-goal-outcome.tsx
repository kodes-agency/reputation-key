// A goal reached, or ended by something other than a manager, told on the Goals
// page for a while after it happened (`recentOutcome`): the snapshot consumer
// usually reaches a goal before anyone looks, so the news comes from History as
// often as from the read that found it. It says what happened, on which day,
// and offers what comes next: after reaching, "Set your next goal" ("Pick a
// plan", whose plans start from the next tenth or a realistic one a little
// higher, round 2) or "Keep 4.5"; after an end it did not choose, a new goal
// (ADR 0067, decision 6).
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { StatusBadge } from '#/components/ui/status-badge'
import { formatShortDate } from '#/lib/format'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { RatingGoalCardHeader } from './rating-goal-card'
import { endedSentence, ratingText, type RatingGoalOutcomeView } from './rating-goal-view'
import type { RatingGoalWizardIntent } from './rating-goal-wizard-view'

/** The highest tenth a goal can climb to (4.9): there is no "next" past it. */
const HIGHEST_TENTHS = 49

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
  return (
    <>
      {targetTenths < HIGHEST_TENTHS ? (
        <Button onClick={() => onStart({ kind: 'climb' })}>Set your next goal</Button>
      ) : null}
      <Button variant="outline" onClick={() => onStart({ kind: 'keep', targetTenths })}>
        {`Keep ${ratingText(outcome.target)}`}
      </Button>
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
