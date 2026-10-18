// What a change sheet's primary sends (PLAN PG-14, PG-21): "now" as a change
// of the running month and the months after it, against what the sheet showed
// of that month (its number, the version, the month the months after start
// with); "from next month" as a revision from the month the sheet said, against
// the version it opened on. The Monthly portal goal's sheet and the average's
// send the same shape; the Property is the page's to add. Pure.
import type {
  ChangeMonthlyPortalGoalNowRequest,
  PortalGoalChangeFacts,
  ReviseMonthlyPortalGoalRequest,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'

export type PortalGoalChangeSubmission =
  | Readonly<{ when: 'now'; data: Omit<ChangeMonthlyPortalGoalNowRequest, 'propertyId'> }>
  | Readonly<{ when: 'next'; data: Omit<ReviseMonthlyPortalGoalRequest, 'propertyId'> }>

/** The change as the sheet made it: when, which goal, what it measures, and the number. */
type Made = Readonly<{
  when: 'now' | 'next'
  programId: string
  /** The goal's version as the sheet opened on it. */
  version: number
  metric: ReviseMonthlyPortalGoalRequest['metric']
  targetValue: number
  /** The note as typed; empty sends none. */
  note: string
  targetSource: 'recommended' | 'own'
}>

/** The command and its keys; null for "now" while no month can change now. */
export function changeSubmissionOf(
  made: Made,
  change: PortalGoalChangeFacts,
): PortalGoalChangeSubmission | null {
  const note = made.note.trim()
  const shared = {
    programId: made.programId,
    targetValue: made.targetValue,
    ...(note === '' ? {} : { note }),
    targetSource: made.targetSource,
  }
  if (made.when === 'next') {
    return {
      when: 'next',
      data: {
        ...shared,
        metric: made.metric,
        expectedVersion: made.version,
        startMonth: change.nextMonthKey,
      },
    }
  }
  if (change.now === null) return null
  const { monthKey, expectedTarget, expectedVersion, expectedFollowingMonth } = change.now
  return {
    when: 'now',
    data: {
      ...shared,
      month: monthKey,
      expectedTarget,
      expectedVersion,
      expectedFollowingMonth,
    },
  }
}
