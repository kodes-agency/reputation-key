import { Stars, ReplyStatusBadge } from './property-dashboard-helpers'
import type { RecentReview } from '#/contexts/dashboard/application/public-api'

const dashboardDateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

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
          {dashboardDateFormatter.format(review.reviewedAt)}
        </p>
      </div>
      <ReplyStatusBadge status={review.replyStatus} />
    </div>
  )
}
