// Dashboard context — §9 reply-workflow redaction for dashboard reads.
//
// dashboard.read reaches roles without reply.manage, which may not see reply
// state. The Property dashboard reads (getDashboardDataFn and
// getPropertyOverviewFn) pass their reply-derived fields through here before
// they leave the server.

import type { DashboardData } from '../domain/dashboard-types'

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
