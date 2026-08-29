import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import type { AiTrendReportRead } from '#/contexts/ai/application/public-api'

/** The read states this section renders, narrowed off the single server union. */
export type TrendPendingRead = Extract<
  AiTrendReportRead,
  { status: 'preparing' | 'updating' }
>
export type TrendQuietRead = Extract<
  AiTrendReportRead,
  { status: 'insufficient_data' | 'no_material_change' }
>
export type TrendReadyRead = Extract<AiTrendReportRead, { status: 'ready' }>

const directionIcon = {
  improving: ArrowUpRight,
  stable: ArrowRight,
  declining: ArrowDownRight,
} as const

/** Shared chrome for the non-report states so their headings stay identical. */
function TrendNotice({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <section aria-labelledby="review-trends-heading">
      <h2
        id="review-trends-heading"
        className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
      >
        Review trends
      </h2>
      <div className="mt-3 rounded-lg border p-4">{children}</div>
    </section>
  )
}

export function TrendUnavailableNotice() {
  return (
    <TrendNotice>
      <p className="text-sm text-muted-foreground">
        Review trends are unavailable right now. The rest of the dashboard is unaffected.
      </p>
    </TrendNotice>
  )
}

export function TrendPendingNotice({ trend }: Readonly<{ trend: TrendPendingRead }>) {
  return (
    <TrendNotice>
      <p className="text-sm text-muted-foreground">
        {trend.status === 'updating'
          ? 'Review trends are updating as current review analysis catches up.'
          : 'Building a trend after enough current review signals are available.'}
      </p>
      {trend.status === 'updating' && trend.evidence ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Data through {trend.evidence.dataThroughLocalDate}
        </p>
      ) : null}
    </TrendNotice>
  )
}

export function TrendQuietNotice({ trend }: Readonly<{ trend: TrendQuietRead }>) {
  const evidence = trend.evidence
  return (
    <TrendNotice>
      <h3 className="text-base font-semibold">
        {trend.status === 'insufficient_data'
          ? 'Not enough review data'
          : 'No notable change'}
      </h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {evidence.current.analyzedCount.toLocaleString()} analyzed text reviews in the
        latest complete period and {evidence.baseline.analyzedCount.toLocaleString()} in
        the preceding period.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Data through {evidence.dataThroughLocalDate}
        {trend.updating ? ' · Updating' : ''} · star-only ratings{' '}
        {evidence.current.starOnlyCount.toLocaleString()} current /{' '}
        {evidence.baseline.starOnlyCount.toLocaleString()} preceding
      </p>
    </TrendNotice>
  )
}

/** The narrative body: sentences when present, otherwise the summary paragraph. */
function TrendNarrative({ report }: Readonly<{ report: TrendReadyRead['report'] }>) {
  if (report.sentences && report.sentences.length > 0) {
    return (
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        {report.sentences.map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ul>
    )
  }
  if (report.summary) {
    return <p className="mt-2 text-sm text-muted-foreground">{report.summary}</p>
  }
  return null
}

function TrendSupportingReviews({
  evidence,
}: Readonly<{ evidence: TrendReadyRead['evidence'] }>) {
  if (evidence.supportingReviews.length === 0) return null
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-muted-foreground">Supporting reviews</p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {evidence.supportingReviews.slice(0, 5).map((review) => (
          <li key={review.reviewId}>
            <a className="underline underline-offset-2" href={review.href}>
              {review.localDate}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function TrendReadyReport({ trend }: Readonly<{ trend: TrendReadyRead }>) {
  const report = trend.report
  const evidence = trend.evidence
  const DirectionIcon = directionIcon[report.direction]

  return (
    <section aria-labelledby="review-trends-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2
          id="review-trends-heading"
          className="mr-auto text-sm font-medium uppercase tracking-wide text-muted-foreground"
        >
          Review trends
        </h2>
        <Badge variant="outline">
          <DirectionIcon className="size-3.5" />
          {report.direction}
        </Badge>
      </div>
      <div className="mt-3 rounded-lg border p-4">
        <h3 className="text-base font-semibold">
          {report.headline ?? 'Notable review changes'}
        </h3>
        <TrendNarrative report={report} />
        <p className="mt-3 text-xs text-muted-foreground">
          Based on {report.supportingReviewCount.toLocaleString()} current reviews ·
          largest change {Math.round(report.changeMagnitudeBasisPoints / 100)} pts
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Data through {evidence.dataThroughLocalDate}
          {trend.updating ? ' · Updating' : ''} · analysis coverage{' '}
          {(evidence.current.coverageBasisPoints / 100).toFixed(1)}% current /{' '}
          {(evidence.baseline.coverageBasisPoints / 100).toFixed(1)}% preceding ·
          star-only ratings {evidence.current.starOnlyCount.toLocaleString()} current /{' '}
          {evidence.baseline.starOnlyCount.toLocaleString()} preceding
        </p>
        <TrendSupportingReviews evidence={evidence} />
      </div>
    </section>
  )
}
