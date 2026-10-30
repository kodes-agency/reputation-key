import { InlineLink } from '#/components/ui/inline-link'
import type { GoogleNumbersView } from '#/contexts/reporting/application/public-api'
import {
  googleRatingLine,
  goalTargetWords,
  type GuestVoiceGoalFacts,
} from './guest-voice-rating-goal-words'

/** Independent Google snapshot and goal facts; a missing side-read leaves the other useful. */
export function GuestVoiceRatingGoal({
  propertyId,
  google,
  goal,
}: Readonly<{
  propertyId: string
  google?: GoogleNumbersView | null
  goal?: GuestVoiceGoalFacts | null
}>) {
  if (!google && !goal) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {googleRatingLine(google) ? <span>{googleRatingLine(google)}</span> : null}
      {goal ? (
        <>
          {googleRatingLine(google) ? <span aria-hidden="true">·</span> : null}
          <InlineLink
            to="/properties/$propertyId/goals/google-rating"
            params={{ propertyId }}
            aria-label={`Open the goal · ${goal.mode === 'keep' ? 'keep' : 'reach'} ${goal.target.toFixed(1)} stars`}
          >
            <span className="md:hidden">{goalTargetWords(goal)} ›</span>
            <span className="hidden md:inline">
              {goalTargetWords(goal)} · Open the goal
            </span>
          </InlineLink>
        </>
      ) : null}
    </span>
  )
}
