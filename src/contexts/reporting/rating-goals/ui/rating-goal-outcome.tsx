// The snapshot consumer often reaches a goal before the page is read, so recent
// outcomes also come from History. Keep is offered alongside a climb at 4.7 or 4.8 and
// alone at 4.9 or 5.0, where no higher tenth can be planned.

import { ratingGoalNextIntents } from './rating-goal-offers'
import { Button } from '#/components/ui/button'
import { CardContent } from '#/components/ui/card'
import { formatShortDate } from '#/lib/format'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { GoalCardActions, GoalCardFrame } from '#/components/goals/goal-card-frame'
import { RATING_GOAL_HEADING_ID, RATING_GOAL_TITLE } from './rating-goal-card-header'
import { endedSentence, ratingText, type RatingGoalOutcomeView } from './rating-goal-view'
import type { RatingGoalWizardIntent } from './rating-goal-wizard-view'

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
  return ratingGoalNextIntents(outcome).map((intent) => (
    <Button
      key={intent.kind}
      variant={intent.kind === 'keep' ? 'outline' : 'default'}
      onClick={() => onStart(intent)}
    >
      {intent.kind === 'keep'
        ? `Keep ${ratingText(intent.targetTenths / 10)}`
        : outcome.state === 'ended'
          ? 'Set a new goal'
          : 'Set your next goal'}
    </Button>
  ))
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
    <GoalCardFrame
      slot="rating-goal-outcome"
      title={RATING_GOAL_TITLE}
      titleId={RATING_GOAL_HEADING_ID}
      status={OUTCOME[outcome.state]}
    >
      <CardContent className="flex flex-col gap-4">
        <p className="text-lg font-semibold">
          {outcome.state === 'reached'
            ? reachedSentence(outcome, googleShowsNow, day)
            : `${endedSentence(outcome.endedReason)}. Your goal was ${ratingText(outcome.target)} on Google.`}
        </p>
        {can('goal.create') && canSetNext ? (
          <GoalCardActions>
            <NextSteps outcome={outcome} onStart={onStart} />
          </GoalCardActions>
        ) : null}
      </CardContent>
    </GoalCardFrame>
  )
}
