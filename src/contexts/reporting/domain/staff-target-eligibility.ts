import type { GoalMetric } from './goal-program'
export type StaffTargetProblem =
  'staff_scan_only' | 'staff_scan_targets_disabled' | 'staff_private_ratings_skipped'
export function staffTargetProblem(
  portals: readonly Readonly<{ kind?: string; skipPrivateRating?: boolean }>[],
  metric: GoalMetric,
  enabled: boolean,
): StaffTargetProblem | null {
  if (!portals.some((portal) => portal.kind === 'personal')) return null
  if (metric !== 'qualified_scans') return 'staff_scan_only'
  if (!enabled) return 'staff_scan_targets_disabled'
  return portals.some((portal) => portal.skipPrivateRating)
    ? 'staff_private_ratings_skipped'
    : null
}
export const STAFF_TARGET_MESSAGES: Readonly<Record<StaffTargetProblem, string>> = {
  staff_scan_only: 'A target for staff can only count scans.',
  staff_scan_targets_disabled: 'Scan targets for staff are paused.',
  staff_private_ratings_skipped:
    'Every portal in a staff scan target must collect private ratings. Turn off Skip private rating first.',
}
