// What a reply-time figure says when there is no average to show (pure).
//
// Replies written directly on Google count for the reply rate (owner decision,
// 2026-10-17), but a reply Google gave no time for is left out of the average:
// RepKey never stands in the time it read Google. So a period can have replied
// reviews and still no reply time, and "nothing replied to yet" beside a 40%
// reply rate would contradict the figure next to it.
import type { DashboardData } from '#/contexts/reporting/application/public-api'

export type ReplyTimeMissing = 'no_reviews' | 'no_replies' | 'no_reply_times'

/** Why there is no average reply time to show; null when there is one. */
export function replyTimeMissing(
  hasReviews: boolean,
  { replyRate, avgReplyHours }: DashboardData['replyPerformance'],
): ReplyTimeMissing | null {
  if (!hasReviews) return 'no_reviews'
  if (avgReplyHours !== null) return null
  return replyRate > 0 ? 'no_reply_times' : 'no_replies'
}
