import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import {
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '#/components/ui/chart'
import { ChartFrame, ChartTooThin } from '#/components/features/shared/chart-frame'
import type {
  RatingTrendPoint,
  ReviewVolumePoint,
} from '#/contexts/reporting/application/public-api'
import { axisTicks, hasEnoughEvidence } from '#/shared/chart-buckets'
import {
  bucketUnitForRange,
  DASHBOARD_RANGE_LABELS,
  type DashboardRange,
} from '#/shared/dashboard-range'
import {
  buildPropertyReputationTrendData,
  type PropertyReputationTrendDatum,
} from './property-reputation-trend-chart-data'

const config = {
  newReviews: { label: 'New reviews', color: 'var(--muted-foreground)' },
  runningAverage: { label: 'Running average', color: 'var(--foreground)' },
} satisfies ChartConfig

function formatRating(value: number): string {
  return value.toFixed(1)
}

function reviewCountLabel(count: number): string {
  return `${count.toLocaleString()} new ${count === 1 ? 'review' : 'reviews'}`
}

function trendCaption(
  range: DashboardRange,
  points: readonly PropertyReputationTrendDatum[],
): string {
  const ratings = points.flatMap((point) =>
    point.runningAverage === undefined ? [] : [point.runningAverage],
  )
  const reviewCount = points.reduce((sum, point) => sum + point.newReviews, 0)
  const period = DASHBOARD_RANGE_LABELS[range].toLowerCase()
  const first = ratings[0]
  const last = ratings[ratings.length - 1]

  if (first === undefined || last === undefined) {
    return `${reviewCountLabel(reviewCount)} over ${period} · rating average unavailable`
  }
  if (ratings.length === 1) {
    return `${formatRating(last)} over ${period} · ${reviewCountLabel(reviewCount)}`
  }
  return `${formatRating(first)} → ${formatRating(last)} over ${period} · ${reviewCountLabel(reviewCount)}`
}

/**
 * New-review volume and the weighted running rating for the selected period.
 * Independent daily series are merged by date before they are bucketed.
 */
export function PropertyReputationTrendChart({
  ratingTrend,
  reviewVolume,
  range,
}: Readonly<{
  ratingTrend: readonly RatingTrendPoint[]
  reviewVolume: readonly ReviewVolumePoint[]
  range: DashboardRange
}>) {
  const { buckets, points } = buildPropertyReputationTrendData(
    ratingTrend,
    reviewVolume,
    bucketUnitForRange(range),
  )

  if (points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="reputation-trend-empty">
        No reviews in this period yet, so there is no trend to show.
      </p>
    )
  }

  const caption = trendCaption(range, points)
  if (!hasEnoughEvidence(buckets)) {
    return (
      <div data-testid="reputation-trend-too-thin">
        <ChartTooThin>
          {caption}. More review history is needed before a trend is useful.
        </ChartTooThin>
      </div>
    )
  }

  const labels = new Map(points.map((point) => [point.date, point.label]))
  const ticks = axisTicks(buckets)
  const hasReviewVolume = points.some((point) => point.newReviews > 0)
  const hasRunningAverage = points.some((point) => point.runningAverage !== undefined)
  const series = [
    ...(hasReviewVolume ? ['review-volume'] : []),
    ...(hasRunningAverage ? ['average-rating'] : []),
  ].join(',')

  return (
    <div
      className="min-w-0"
      data-testid="reputation-trend-chart"
      data-point-count={points.length}
      data-series={series}
    >
      <ChartFrame
        label="Rating over time"
        caption={caption}
        size="standard"
        config={config}
      >
        <ComposedChart
          accessibilityLayer
          data={points}
          margin={{ left: 0, right: 0, top: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            ticks={ticks}
            interval={0}
            tickLine={false}
            axisLine={false}
            minTickGap={12}
            tickFormatter={(value: string) => labels.get(value) ?? value}
          />
          <YAxis
            yAxisId="count"
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            width={32}
          />
          <YAxis
            yAxisId="rating"
            orientation="right"
            domain={[1, 5]}
            ticks={[1, 2, 3, 4, 5]}
            tickLine={false}
            axisLine={false}
            width={32}
            hide={!hasRunningAverage}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label) =>
                  typeof label === 'string' ? (labels.get(label) ?? label) : label
                }
              />
            }
          />
          {hasReviewVolume && hasRunningAverage ? (
            <ChartLegend content={<ChartLegendContent />} />
          ) : null}
          <Bar
            yAxisId="count"
            dataKey="newReviews"
            fill="var(--color-newReviews)"
            radius={[4, 4, 0, 0]}
          />
          <Line
            yAxisId="rating"
            type="monotone"
            dataKey="runningAverage"
            stroke="var(--color-runningAverage)"
            strokeWidth={2}
            dot={points.length === 1}
            connectNulls
          />
        </ComposedChart>
      </ChartFrame>

      <details className="mt-2 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center text-muted-foreground">
          View chart values
        </summary>
        <dl className="max-h-72 divide-y overflow-y-auto border-y">
          {points.map((point) => (
            <div
              key={point.date}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 py-2"
            >
              <dt className="font-medium">{point.label}</dt>
              <dd className="text-right tabular-nums">
                {point.newReviews.toLocaleString()} new{' '}
                {point.newReviews === 1 ? 'review' : 'reviews'}
              </dd>
              <dt className="text-muted-foreground">Running average</dt>
              <dd className="text-right tabular-nums text-muted-foreground">
                {point.runningAverage === undefined
                  ? 'Not available yet'
                  : `${formatRating(point.runningAverage)} ★`}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  )
}
