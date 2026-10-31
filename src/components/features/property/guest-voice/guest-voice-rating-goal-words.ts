import type { GoogleNumbersView } from '#/contexts/reporting/application/public-api'
import type {
  RatingGoalMode,
  RatingGoalStatus,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { formatSnapshotDate } from '#/lib/format-snapshot'
export type GuestVoiceGoalFacts = Readonly<{
  mode: RatingGoalMode
  target: number
  shows: number | null
  status: RatingGoalStatus
}>
/** Google figures always carry their actual verification date, including stale snapshots. */
export function googleRatingLine(
  google: GoogleNumbersView | null | undefined,
  now: Date | string = new Date(),
): string | null {
  if (google?.shows == null) return null
  return `Google rating ${google.shows.toFixed(1)}★ (${formatSnapshotDate(google.asOf, now)})`
}
export function goalTargetWords(goal: GuestVoiceGoalFacts): string {
  return `Your goal ${goal.target.toFixed(1)}★`
}
