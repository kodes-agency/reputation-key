// Show who last changed a running month's target, when, how often and its original
// value so a late reduction cannot look like the original target. The read omits the
// marker when the target returns to its original value.

import type { GoalMetric } from '#/contexts/reporting/application/public-api'
import type { GoalMonthTargetMarker } from '#/contexts/reporting/application/goal-month-target-marker'
import { formatShortDate } from '#/lib/format'
import { goalFigure } from './goal-so-far'

export type GoalMarkerFrame = Readonly<{
  /** The calendar the day is read on: the Property's. */
  timezone: string
  now: Date
  /** The person's name; null where the directory cannot give one. */
  personName: (userId: string) => string | null
}>

/** What someone the directory no longer lists is called. */
const FORMER_MEMBER = 'a former member'

/**
 * How a goal's page names people. A member is named; someone the directory
 * was read without is a former member. While the directory has not been read
 * (still loading, failed, or not this reader's to see) nobody is named, and the
 * sentence that would have named them is said without a person.
 */
export function goalPersonNames(
  members: readonly Readonly<{ userId: string; name: string }>[] | undefined,
): (userId: string) => string | null {
  if (members === undefined) return () => null
  const names = new Map(members.map((member) => [member.userId, member.name]))
  return (userId) => names.get(userId) ?? FORMER_MEMBER
}

/** "Oct 20", or "Oct 31 (2 changes)" for a target changed more than once. */
function changedOn(
  marker: GoalMonthTargetMarker,
  frame: Pick<GoalMarkerFrame, 'timezone' | 'now'>,
): string {
  const day =
    formatShortDate(marker.changedAt, frame.timezone, frame.now) ?? 'an unknown date'
  return marker.changeCount > 1 ? `${day} (${marker.changeCount} changes)` : day
}

/** "Changed by Marco on Oct 20, started at 400". */
export function goalTargetMarkerLine(
  metric: GoalMetric,
  marker: GoalMonthTargetMarker,
  frame: GoalMarkerFrame,
): string {
  const name = frame.personName(marker.changedBy)
  const changed = name === null ? 'Changed' : `Changed by ${name}`
  return `${changed} on ${changedOn(marker, frame)}, started at ${goalFigure(metric, marker.startTarget)}`
}

/** The marker inside a line of other facts: "changed Oct 20, started at 400". */
export function goalTargetMarkerNote(
  metric: GoalMetric,
  marker: GoalMonthTargetMarker,
  frame: Pick<GoalMarkerFrame, 'timezone' | 'now'>,
): string {
  return `changed ${changedOn(marker, frame)}, started at ${goalFigure(metric, marker.startTarget)}`
}
