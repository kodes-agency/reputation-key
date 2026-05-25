import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  Area,
  AreaChart,
  CartesianGrid,
  Funnel,
  FunnelChart,
  LabelList,
  Cell,
} from 'recharts'
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
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-lg border bg-muted/30 p-4 ${className ?? ''}`}>
      <h3 className="mb-3 text-sm font-semibold tracking-tight">{title}</h3>
      {children}
    </div>
  )
}

const funnelConfig = {
  scans: { label: 'Scans', color: 'var(--chart-1)' },
  ratings: { label: 'Ratings', color: 'var(--chart-2)' },
  reviewLinkClicks: { label: 'Review Clicks', color: 'var(--chart-3)' },
} satisfies ChartConfig

export function EngagementFunnelChart({
  funnel,
}: {
  funnel: { scans: number; ratings: number; reviewLinkClicks: number }
}) {
  const data = [
    { value: funnel.scans, name: 'Scans', fill: 'var(--color-scans)' },
    { value: funnel.ratings, name: 'Ratings', fill: 'var(--color-ratings)' },
    {
      value: funnel.reviewLinkClicks,
      name: 'Review Clicks',
      fill: 'var(--color-reviewLinkClicks)',
    },
  ]

  return (
    <ChartContainer config={funnelConfig} className="min-h-[250px] w-full">
      <FunnelChart>
        <ChartTooltip content={<ChartTooltipContent />} />
        <Funnel dataKey="value" data={data} isAnimationActive>
          <LabelList
            position="right"
            dataKey="name"
            fill="currentColor"
            stroke="none"
            className="fill-foreground text-xs"
          />
          <LabelList
            position="center"
            dataKey="value"
            fill="#fff"
            stroke="none"
            className="text-xs font-medium"
          />
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.fill} />
          ))}
        </Funnel>
      </FunnelChart>
    </ChartContainer>
  )
}

const distConfig = {
  count: { label: 'Count', color: 'var(--chart-1)' },
} satisfies ChartConfig

export function RatingDistributionChart({
  distribution,
}: {
  distribution: readonly { stars: number; count: number }[]
}) {
  const data = distribution.map((b) => ({ stars: `${b.stars}★`, count: b.count }))

  return (
    <ChartContainer config={distConfig} className="min-h-[200px] w-full">
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

export function RatingTrendChart({
  trend,
}: {
  trend: readonly { date: string; avgRating: number }[]
}) {
  const data = trend.map((p) => ({
    date: p.date,
    avgRating: Math.round(p.avgRating * 10) / 10,
  }))

  return (
    <ChartContainer config={trendConfig} className="min-h-[250px] w-full">
      <AreaChart data={data} margin={{ left: 0, right: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => {
            const d = new Date(v)
            return `${d.getMonth() + 1}/${d.getDate()}`
          }}
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
