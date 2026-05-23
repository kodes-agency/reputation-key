import { Stars, ReplyStatusBadge } from './property-dashboard-helpers'
import type { RecentReview } from '#/contexts/dashboard/application/public-api'

export function ReviewRow({ review }: { review: RecentReview }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border p-3">
      <div className="flex flex-col items-center gap-1">
        <span className="text-lg font-semibold">{review.rating}</span>
        <Stars rating={review.rating} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{review.snippet}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {review.reviewedAt.toLocaleDateString()}
        </p>
      </div>
      <ReplyStatusBadge status={review.replyStatus} />
    </div>
  )
}
