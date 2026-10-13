import { Link } from '@tanstack/react-router'
import { Stars, ReplyStatusBadge } from './property-dashboard-helpers'
import type { RecentReview } from '#/contexts/reporting/application/public-api'
import { formatDate } from '#/lib/format'
import { ROW_LINK_SURFACE } from '#/components/ui/row-link'
import { cn } from '#/lib/utils'

/**
 * Format a review date, or render nothing when it is not a real instant.
 *
 * `reviewedAt` is typed `Date`, and for a while it was not one: Review's
 * serving read selected the column through a raw `sql` template, which decodes
 * nothing, so the row carried the database driver's text for the timestamp.
 * `Intl.DateTimeFormat#format` throws `RangeError: Invalid time value` on a
 * value that is not an instant. That threw during render, so the whole
 * property page died rather than one row losing its date — which is what the
 * e2e error gate caught on /properties/$id. The read returns a Date now
 * (`review/infrastructure/serving-stats.ts`); this guard stays, because
 * `formatDate` answers null for anything that is not a real instant.
 */
export function formatReviewedAt(value: Date): string | null {
  return formatDate(value)
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
      className={cn(
        'flex min-h-11 items-center gap-4 rounded-lg border p-3',
        ROW_LINK_SURFACE,
      )}
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
