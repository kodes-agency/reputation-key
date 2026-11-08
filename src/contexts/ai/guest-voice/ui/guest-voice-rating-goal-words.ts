import type {
  GoogleNumbersView,
  FleetRatingGoal,
} from '#/contexts/reporting/application/public-api'
import { formatSnapshotDate } from '#/lib/format-snapshot'
type SetRatingGoal = Extract<FleetRatingGoal, { kind: 'set' }>
export type GuestVoiceGoalFacts = Readonly<{
  mode: SetRatingGoal['mode']
  target: number
  shows: number | null
  status: NonNullable<SetRatingGoal['status']>
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
