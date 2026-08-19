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

  if (
    trend.data?.status === 'preparing' ||
    trend.data?.status === 'snapshot_superseded'
  ) {
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
            Building a trend after enough current review signals are available.
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
          largest change {Math.round(report.confidenceBasisPoints / 100)} pts
        </p>
      </div>
    </section>
  )
}
