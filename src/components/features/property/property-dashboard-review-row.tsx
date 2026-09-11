import { Link } from '@tanstack/react-router'
import { Stars, ReplyStatusBadge } from './property-dashboard-helpers'
import type { RecentReview } from '#/contexts/reporting/application/public-api'

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
export function formatReviewedAt(value: Date): string | null {
  const time = value instanceof Date ? value.getTime() : Number.NaN
  return Number.isFinite(time) ? dashboardDateFormatter.format(value) : null
}

/**
 * The whole row is the link. It used to be inert, with a single "View all"
 * above the list — so the five reviews a manager most wants to open were the
 * only things on the page that could not be clicked (redesign row 4).
 */
export function ReviewRow({
  review,
  propertyId,
}: Readonly<{ review: RecentReview; propertyId: string }>) {
  return (
    <Link
      to="/inbox"
      search={{ propertyId, reviewId: review.id }}
      className="flex min-h-11 items-center gap-4 rounded-lg border p-3 transition-colors hover:border-border hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="flex flex-col items-center gap-1">
        <span className="text-lg font-semibold">{review.rating}</span>
        <Stars rating={review.rating} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{review.snippet}</span>
        {formatReviewedAt(review.reviewedAt) !== null && (
          <span className="mt-1 block text-xs text-muted-foreground">
            {formatReviewedAt(review.reviewedAt)}
          </span>
        )}
      </span>
      <ReplyStatusBadge status={review.replyStatus} />
    </Link>
  )
}
