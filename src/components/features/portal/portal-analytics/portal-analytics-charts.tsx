import { useId } from 'react'
import { Bar, BarChart, XAxis, YAxis, Area, AreaChart, CartesianGrid } from 'recharts'
import { cn } from '#/lib/utils'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '#/components/ui/chart'

export function ChartCard({
  title,
  children,
  className,
}: {
  title: string
  /** Render prop: receives the id of this card's heading. A chart is a graphics
   * region with no text of its own, so a bare sibling <h3> leaves screen
   * readers with an unnamed graphic — the chart must point `aria-labelledby` at
   * the heading. Same association as google-performance-chart.tsx. */
  children: (headingId: string) => React.ReactNode
  className?: string
}) {
  const headingId = useId()

  return (
    <div className={cn('rounded-lg border bg-muted/30 p-4', className)}>
      <h3 id={headingId} className="mb-3 text-sm font-semibold tracking-tight">
        {title}
      </h3>
      {children(headingId)}
    </div>
  )
}

const distConfig = {
  count: { label: 'Count', color: 'var(--chart-1)' },
} satisfies ChartConfig

export function PortalRatingDistributionChart({
  distribution,
  labelledBy,
}: {
  distribution: readonly { stars: number; count: number }[]
  labelledBy: string
}) {
  // The distribution is a GROUP BY over portal.rating readings, so a period
  // without ratings yields no buckets at all (and a filtered-to-zero period
  // yields only zeroes). Either way a bar chart draws an axis-only skeleton
  // that looks broken — say why it is empty instead.
  const total = distribution.reduce((sum, bucket) => sum + bucket.count, 0)
  if (total === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No ratings in this period.
      </p>
    )
  }

  const data = distribution.map((b) => ({ stars: `${b.stars}★`, count: b.count }))

  return (
    <ChartContainer
      config={distConfig}
      role="img"
      aria-labelledby={labelledBy}
      className="min-h-[200px] w-full"
    >
      <BarChart data={data} margin={{ left: 0, right: 0 }}>
        <XAxis dataKey="stars" tickLine={false} axisLine={false} />
        <YAxis hide />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  )
}

const trendConfig = {
  avgRating: { label: 'Avg Rating', color: 'var(--chart-2)' },
} satisfies ChartConfig

/** Tick label for a `YYYY-MM-DD` bucket date. Parsed by parts, never through
 * `new Date(v)`: a bare date string is parsed as UTC midnight while
 * `getMonth()`/`getDate()` read LOCAL calendar fields, so every label west of
 * UTC lands a day early and the chart contradicts the KPI cards. Mirrors
 * google-performance-chart.tsx's shortDate. */
function shortDate(bucketDate: string): string {
  const [, month, day] = bucketDate.split('-')
  return `${Number(month)}/${Number(day)}`
}

export function RatingTrendChart({
  trend,
  labelledBy,
}: {
  trend: readonly { date: string; avgRating: number }[]
  labelledBy: string
}) {
  const data = trend.map((p) => ({
    date: p.date,
    avgRating: Math.round(p.avgRating * 10) / 10,
  }))

  return (
    <ChartContainer
      config={trendConfig}
      role="img"
      aria-labelledby={labelledBy}
      className="min-h-[250px] w-full"
    >
      <AreaChart data={data} margin={{ left: 0, right: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickFormatter={shortDate}
        />
        <YAxis
          domain={[0, 5]}
          ticks={[0, 1, 2, 3, 4, 5]}
          tickLine={false}
          axisLine={false}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          type="monotone"
          dataKey="avgRating"
          stroke="var(--color-avgRating)"
          fill="var(--color-avgRating)"
          fillOpacity={0.2}
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  )
}
