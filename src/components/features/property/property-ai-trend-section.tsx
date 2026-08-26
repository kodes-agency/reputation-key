import { useQuery } from '@tanstack/react-query'
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import type { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import { aiKeys } from '#/shared/queries/query-keys'

export type PropertyAiTrendServerFn = typeof getPropertyAiTrendFn

const directionIcon = {
  improving: ArrowUpRight,
  stable: ArrowRight,
  declining: ArrowDownRight,
} as const

export function PropertyAiTrendSection({
  propertyId,
  getTrend,
}: Readonly<{
  propertyId: string
  getTrend: PropertyAiTrendServerFn
}>) {
  const trend = useQuery({
    queryKey: aiKeys.propertyTrend(propertyId),
    queryFn: () => getTrend({ data: { propertyId } }),
    staleTime: 60_000,
    retry: false,
  })

  if (trend.isPending || trend.data?.status === 'disabled') return null

  if (trend.isError) {
    return (
      <section aria-labelledby="review-trends-heading">
        <h2
          id="review-trends-heading"
          className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
        >
          Review trends
        </h2>
        <div className="mt-3 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            Review trends are unavailable right now. The rest of the dashboard is
            unaffected.
          </p>
        </div>
      </section>
    )
  }

  if (trend.data?.status === 'preparing' || trend.data?.status === 'updating') {
    return (
      <section aria-labelledby="review-trends-heading">
        <h2
          id="review-trends-heading"
          className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
        >
          Review trends
        </h2>
        <div className="mt-3 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            {trend.data.status === 'updating'
              ? 'Review trends are updating as current review analysis catches up.'
              : 'Building a trend after enough current review signals are available.'}
          </p>
          {trend.data.status === 'updating' && trend.data.evidence ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Data through {trend.data.evidence.dataThroughLocalDate}
            </p>
          ) : null}
        </div>
      </section>
    )
  }

  if (
    trend.data?.status === 'insufficient_data' ||
    trend.data?.status === 'no_material_change'
  ) {
    const evidence = trend.data.evidence
    return (
      <section aria-labelledby="review-trends-heading">
        <h2
          id="review-trends-heading"
          className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
        >
          Review trends
        </h2>
        <div className="mt-3 rounded-lg border p-4">
          <h3 className="text-base font-semibold">
            {trend.data.status === 'insufficient_data'
              ? 'Not enough review data'
              : 'No notable change'}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {evidence.current.analyzedCount.toLocaleString()} analyzed text reviews in the
            latest complete period and {evidence.baseline.analyzedCount.toLocaleString()}{' '}
            in the preceding period.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Data through {evidence.dataThroughLocalDate}
            {trend.data.updating ? ' · Updating' : ''} · star-only ratings{' '}
            {evidence.current.starOnlyCount.toLocaleString()} current /{' '}
            {evidence.baseline.starOnlyCount.toLocaleString()} preceding
          </p>
        </div>
      </section>
    )
  }

  if (!trend.data || trend.data.status !== 'ready') return null
  const report = trend.data.report
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
        {report.sentences && report.sentences.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {report.sentences.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        ) : report.summary ? (
          <p className="mt-2 text-sm text-muted-foreground">{report.summary}</p>
        ) : null}
        <p className="mt-3 text-xs text-muted-foreground">
          Based on {report.supportingReviewCount.toLocaleString()} current reviews ·
          largest change {Math.round(report.changeMagnitudeBasisPoints / 100)} pts
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Data through {trend.data.evidence.dataThroughLocalDate}
          {trend.data.updating ? ' · Updating' : ''} · analysis coverage{' '}
          {(trend.data.evidence.current.coverageBasisPoints / 100).toFixed(1)}% current /{' '}
          {(trend.data.evidence.baseline.coverageBasisPoints / 100).toFixed(1)}% preceding
          · star-only ratings {trend.data.evidence.current.starOnlyCount.toLocaleString()}{' '}
          current / {trend.data.evidence.baseline.starOnlyCount.toLocaleString()}{' '}
          preceding
        </p>
        {trend.data.evidence.supportingReviews.length > 0 ? (
          <div className="mt-3">
            <p className="text-xs font-medium text-muted-foreground">
              Supporting reviews
            </p>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {trend.data.evidence.supportingReviews.slice(0, 5).map((review) => (
                <li key={review.reviewId}>
                  <a className="underline underline-offset-2" href={review.href}>
                    {review.localDate}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  )
}
