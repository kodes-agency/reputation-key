import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { ROW_FIGURE_LINK } from '#/components/ui/row-link'
import { formatNumber } from '#/lib/format'
import { cn } from '#/lib/utils'
import {
  complaintReviews,
  complaintStars,
  praiseReviews,
  type PropertyInsightsEvidence,
  type TopicChange,
  type TopicRow,
} from './property-insights-topic-rows'

/**
 * The reviews behind one number, opened in the Inbox on the window the table is
 * showing: the list holds the same reviews the number counts, not every review
 * that ever named the topic.
 */
function ReviewsLink({
  propertyId,
  evidence,
  row,
  polarity,
}: Readonly<{
  propertyId: string
  evidence: PropertyInsightsEvidence
  row: TopicRow
  polarity: 'positive' | 'negative'
}>) {
  const count = polarity === 'positive' ? praiseReviews(row) : complaintReviews(row)
  const word =
    polarity === 'positive' ? 'praise' : count === 1 ? 'complaint' : 'complaints'
  const text = `${formatNumber(count)} ${word}`
  // A link to an empty list is a dead end: nothing named it this way, so say so.
  if (count === 0) return <span className="text-muted-foreground">{text}</span>
  return (
    <Link
      to="/inbox"
      search={{
        propertyId,
        aspect: row.aspect,
        polarity,
        since: evidence.startLocalDate,
        until: evidence.endLocalDate,
      }}
      aria-label={`${count} ${polarity === 'positive' ? 'praise' : 'complaint'} ${count === 1 ? 'review' : 'reviews'} for ${row.label}; open in inbox`}
      className={cn('font-medium', ROW_FIGURE_LINK)}
    >
      {text}
    </Link>
  )
}

/**
 * Praise against complaints, as proportions of the reviews that did either. The
 * bar is a picture of the two counts printed under it, never the only place a
 * difference is shown: its colours are a second cue to the words.
 */
export function PraiseAndComplaints({
  propertyId,
  evidence,
  row,
}: Readonly<{
  propertyId: string
  evidence: PropertyInsightsEvidence
  row: TopicRow
}>) {
  const praise = praiseReviews(row)
  const complaints = complaintReviews(row)
  const total = praise + complaints
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span
        aria-hidden="true"
        className="flex h-2 w-full max-w-60 overflow-hidden rounded-full bg-muted"
      >
        {total === 0 ? null : (
          <>
            <span
              className="bg-positive"
              style={{ width: `${(praise / total) * 100}%` }}
            />
            <span
              className="bg-destructive"
              style={{ width: `${(complaints / total) * 100}%` }}
            />
          </>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-x-4 text-sm tabular-nums">
        <ReviewsLink
          propertyId={propertyId}
          evidence={evidence}
          row={row}
          polarity="positive"
        />
        <ReviewsLink
          propertyId={propertyId}
          evidence={evidence}
          row={row}
          polarity="negative"
        />
      </span>
    </div>
  )
}

export function StarsWhenMentioned({ row }: Readonly<{ row: TopicRow }>) {
  const stars = complaintStars(row)
  if (stars.kind === 'none') {
    return <span className="text-sm text-muted-foreground">No complaints</span>
  }
  if (stars.kind === 'too_few') {
    return <span className="text-sm text-muted-foreground">too few</span>
  }
  return (
    <span className="text-sm tabular-nums">
      <span aria-hidden="true">
        {stars.complaining}★, the rest {stars.rest}★
      </span>
      <span className="sr-only">
        Complaining reviews gave {stars.complaining} stars on average, the rest{' '}
        {stars.rest} stars
      </span>
    </span>
  )
}

export function Change({ changes }: Readonly<{ changes: readonly TopicChange[] }>) {
  if (changes.length === 0) return null
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {changes.map((change) => (
        <Badge key={change.text} variant={change.tone}>
          {change.direction === 'up' ? (
            <ArrowUp aria-hidden="true" />
          ) : (
            <ArrowDown aria-hidden="true" />
          )}
          {change.text}
        </Badge>
      ))}
    </span>
  )
}
