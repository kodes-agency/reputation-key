import { useId } from 'react'
import { XAxis, YAxis, Area, AreaChart, CartesianGrid } from 'recharts'
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
