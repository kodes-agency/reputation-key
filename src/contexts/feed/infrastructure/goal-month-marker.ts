// Feed — the one marker a Goal notice or a Recent Activity row may carry about
// the month it reports on (ADR 0046).
//
// "Goal met" is read against a target. When that target did not stand for the
// whole month, the surface says so with one closed token, from the facts
// Reporting reads when the notice is raised. A month can be both: its goal set
// after the month began, and its target changed afterwards. The changed target
// is then the one the month was judged against, so it is the one that is said.
import type { NotificationGoalMarker } from '../domain/notification-payload'

export function goalMonthMarker(
  facts: Readonly<{ setDuringMonth: boolean; targetChangedInMonth: boolean }>,
): NotificationGoalMarker | null {
  if (facts.targetChangedInMonth) return 'target_changed'
  return facts.setDuringMonth ? 'set_in_month' : null
}
