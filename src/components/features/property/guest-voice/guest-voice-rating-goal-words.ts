import type { GoogleNumbersView } from '#/contexts/reporting/application/public-api'
import type {
  RatingGoalMode,
  RatingGoalStatus,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { formatDate } from '#/lib/format'
export type GuestVoiceGoalFacts = Readonly<{
  mode: RatingGoalMode
  target: number
  shows: number | null
  status: RatingGoalStatus
}>
/** Google figures always carry their actual verification date, including stale snapshots. */
export function googleRatingLine(
  google: GoogleNumbersView | null | undefined,
): string | null {
  if (google?.shows == null) return null
  return `Google rating ${google.shows.toFixed(1)}★ (as of ${formatDate(google.asOf)})${google.current ? '' : ' · last known'}`
}
export function goalTargetWords(goal: GuestVoiceGoalFacts): string {
  return `${goal.mode === 'keep' ? 'Keeping' : 'Your goal'} ${goal.target.toFixed(1)}★`
}
