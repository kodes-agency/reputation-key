import { Stars, ReplyStatusBadge } from './property-dashboard-helpers'
import type { RecentReview } from '#/contexts/dashboard/application/public-api'

const dashboardDateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

/**
 * Format a review date, or render nothing when it is not a real instant.
 *
 * `reviewedAt` is typed `Date`, and the type does not survive the wire: a null
 * or unparsable provider timestamp deserializes across the server-function
 * boundary as an Invalid Date, and `Intl.DateTimeFormat#format` throws
 * `RangeError: Invalid time value` on one. That threw during render, so the
 * whole property page died rather than one row losing its date — which is what
 * the e2e error gate caught on /properties/$id.
 *
 * Mirrors the guard `formatPropertyRecoveryDeadline` already uses in
 * property-lifecycle-card.tsx.
 */
function formatReviewedAt(value: Date): string | null {
  const time = value instanceof Date ? value.getTime() : Number.NaN
  return Number.isFinite(time) ? dashboardDateFormatter.format(value) : null
}

export function ReviewRow({ review }: { review: RecentReview }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border p-3">
      <div className="flex flex-col items-center gap-1">
        <span className="text-lg font-semibold">{review.rating}</span>
        <Stars rating={review.rating} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{review.snippet}</p>
        {formatReviewedAt(review.reviewedAt) !== null && (
          <p className="mt-1 text-xs text-muted-foreground">
            {formatReviewedAt(review.reviewedAt)}
          </p>
        )}
      </div>
      <ReplyStatusBadge status={review.replyStatus} />
    </div>
  )
}
