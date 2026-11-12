// Submit against the month, target and version the sheet showed. Changes now cover the
// running and following months; revisions start at the displayed next month.

import type {
  ChangeMonthlyPortalGoalNowRequest,
  PortalGoalChangeFacts,
  ReviseMonthlyPortalGoalRequest,
} from '#/contexts/reporting/monthly-goals/contracts'

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
