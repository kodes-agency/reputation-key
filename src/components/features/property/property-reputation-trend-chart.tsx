import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '#/components/ui/chart'
import type {
  RatingTrendPoint,
  ReviewVolumePoint,
} from '#/contexts/dashboard/application/public-api'
import { buildPropertyReputationTrendData } from './property-reputation-trend-chart-data'

const config = {
  count: { label: 'Reviews', color: 'var(--chart-1)' },
  avgRating: { label: 'Avg rating', color: 'var(--chart-2)' },
} satisfies ChartConfig

/** YYYY-MM-DD read as a calendar date, not shifted into the viewer's zone. */
const shortDate = (value: string): string => {
  const [, month, day] = value.split('-')
  return month && day ? `${Number(month)}/${Number(day)}` : value
}

/**
 * Reputation over time: review volume as bars, average rating as a line on its
 * own 0-5 axis.
 *
 * `ratingTrend` and `reviewVolume` were already computed by
 * `getDashboardData`, serialised into the browser, and then never drawn — the
 * property dashboard rendered only the hand-rolled rating distribution. This is
 * the wiring, not a new pipeline.
 */
export function PropertyReputationTrendChart({
  ratingTrend,
  reviewVolume,
}: Readonly<{
  ratingTrend: readonly RatingTrendPoint[]
  reviewVolume: readonly ReviewVolumePoint[]
}>) {
  // Volume and rating are independent series over the same calendar days, and
  // either can be sparse. Merge on date so neither series silently truncates.
  const data = buildPropertyReputationTrendData(ratingTrend, reviewVolume)

  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="reputation-trend-empty">
        No reviews in this period yet, so there is no trend to show.
      </p>
    )
  }

  // `aspect-video` is ChartContainer's default, which measured 810px tall at a
  // 1440px viewport — it would have owned the whole dashboard fold. Fixed height
  // instead, so the section stays a band regardless of width.
  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-[280px] w-full"
      data-testid="reputation-trend-chart"
      data-point-count={data.length}
      data-series="review-volume,average-rating"
    >
      <ComposedChart data={data} margin={{ left: 0, right: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickFormatter={shortDate}
          minTickGap={16}
        />
        <YAxis yAxisId="count" tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          yAxisId="rating"
          orientation="right"
          domain={[0, 5]}
          ticks={[0, 1, 2, 3, 4, 5]}
          tickLine={false}
          axisLine={false}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) =>
                typeof label === 'string' ? shortDate(label) : label
              }
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          yAxisId="count"
          dataKey="count"
          fill="var(--color-count)"
          radius={[4, 4, 0, 0]}
        />
        <Line
          yAxisId="rating"
          type="monotone"
          dataKey="avgRating"
          stroke="var(--color-avgRating)"
          strokeWidth={2}
          // A single day would draw an invisible zero-length line without this.
          dot={data.length === 1}
          connectNulls
        />
      </ComposedChart>
    </ChartContainer>
  )
}
