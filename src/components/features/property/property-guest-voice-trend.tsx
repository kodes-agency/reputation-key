import { Link } from '@tanstack/react-router'
import { Skeleton } from '#/components/ui/skeleton'
import { ROW_FIGURE_LINK } from '#/components/ui/row-link'
import { cn } from '#/lib/utils'
import { formatLocalDate } from '#/lib/format'
import type {
  AiTrendReportView,
  AiTrendSupportingReviewView,
} from '#/contexts/ai/application/public-api'
import { describeTrend } from './property-guest-voice-trend-words'

function formatSupportingReviewDate(localDate: string): string {
  return formatLocalDate(localDate) ?? localDate
}

function SupportingReview({
  propertyId,
  review,
}: Readonly<{ propertyId: string; review: AiTrendSupportingReviewView }>) {
  const date = formatSupportingReviewDate(review.localDate)
  const label = `${review.window === 'current' ? 'Current period' : 'Previous period'} · ${date}`
  // No item this viewer may open: the evidence stays readable, without a dead link.
  if (review.inboxItemId === null) {
    return (
      <span className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm text-muted-foreground">
        {label}
      </span>
    )
  }
  return (
    <Link
      to="/properties/$propertyId/reviews"
      params={{ propertyId }}
      search={{ itemId: review.inboxItemId }}
      aria-label={`Open supporting review from ${date} in the inbox`}
      className={cn(
        ROW_FIGURE_LINK,
        'inline-flex min-h-11 items-center rounded-md border px-3 text-sm hover:bg-muted/40',
      )}
    >
      {label}
    </Link>
  )
}

export function TrendSupportingReviews({
  propertyId,
  reviews,
}: Readonly<{ propertyId: string; reviews: readonly AiTrendSupportingReviewView[] }>) {
  if (reviews.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">Supporting reviews</p>
      <ul className="flex flex-wrap gap-2">
        {reviews.slice(0, 5).map((review) => (
          <li key={review.reviewId}>
            <SupportingReview propertyId={propertyId} review={review} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The monthly comparison, in whatever state it is in. Its finding is read beside
 * the page and used to pop in above the topics, moving them down. While it is
 * still on its way its line is held, one heading high; every state then fills the
 * same place, so the page closes up only for a property with the comparison off.
 */
export function GuestVoiceTrend({
  trend,
  pending,
  propertyId,
}: Readonly<{
  trend: AiTrendReportView | undefined
  pending: boolean
  propertyId: string
}>) {
  if (pending) {
    return <Skeleton className="h-7 w-3/4 max-w-3xl" aria-hidden="true" />
  }
  const words = trend === undefined ? null : describeTrend(trend)
  if (trend === undefined || words === null) return null

  if (words.kind === 'state' || trend.status !== 'ready') {
    return (
      <div className="flex min-h-7 max-w-3xl flex-col justify-center gap-1">
        <p className="text-sm">{words.text}</p>
        {words.sample === null ? null : (
          <p className="text-sm text-muted-foreground">{words.sample}</p>
        )}
      </div>
    )
  }
  return (
    <section aria-labelledby="guest-voice-headline" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2
          id="guest-voice-headline"
          className="max-w-3xl text-lg font-semibold tracking-tight"
        >
          {words.text}
        </h2>
        {words.sample === null ? null : (
          <p className="text-sm text-muted-foreground">{words.sample}</p>
        )}
      </div>
      <TrendSupportingReviews
        propertyId={propertyId}
        reviews={trend.evidence.supportingReviews}
      />
    </section>
  )
}
