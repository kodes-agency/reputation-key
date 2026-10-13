// Dashboard context — §9 reply-workflow redaction for dashboard reads.
//
// dashboard.read reaches roles without reply.manage, which may not see reply
// state. `getDashboardData` passes its reply-derived fields through here for
// the reader it authorized, so every caller of the read gets the same answer,
// the Property overview included.

import type { DashboardData } from './dashboard-types'

/** Zero the reply metrics and hide per-review reply state without reply.manage. */
export function hideReplyWorkflowWithoutAuthority(
  canManageReplies: boolean,
  dashboard: DashboardData,
): DashboardData {
  if (canManageReplies) return dashboard
  return {
    ...dashboard,
    replyPerformance: { replyRate: 0, avgReplyHours: null },
    recentReviews: dashboard.recentReviews.map((review) => ({
      ...review,
      replyStatus: 'none' as const,
    })),
  }
}
