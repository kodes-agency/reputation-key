import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import type { FixFirstItem } from '#/contexts/ai/application/public-api'
import { useGuestVoice } from './guest-voice-context'
import {
  goalHeadline,
  topProblemLine,
  type GuestVoiceGoalFacts,
} from './guest-voice-rating-goal-words'

/**
 * The Google rating goal beside the top problem: where the goal stands (Google's own
 * number, its pace) and the problem the reviews tie most to a lower rating, with the way
 * into the goal. Reporting owns the goal; this only reads where it stands. Drawn only
 * when the Property has an active goal and the reader can read it.
 */
export function GuestVoiceRatingGoal({
  goal,
  top,
}: Readonly<{
  goal: GuestVoiceGoalFacts | null | undefined
  top: FixFirstItem | undefined
}>) {
  const { propertyId, window } = useGuestVoice()
  if (goal === null || goal === undefined) return null
  const problem = topProblemLine(top, window)
  return (
    <section
      aria-label="Your Google rating goal"
      className="flex flex-col items-start gap-1.5 rounded-xl border bg-card p-4 md:p-5"
    >
      <p className="text-sm text-foreground">{goalHeadline(goal)}</p>
      {problem === null ? null : (
        <p className="text-sm text-muted-foreground">{problem}</p>
      )}
      <Button asChild variant="link" size="inline" touch>
        <Link to="/properties/$propertyId/goals/google-rating" params={{ propertyId }}>
          Open the goal
        </Link>
      </Button>
    </section>
  )
}
