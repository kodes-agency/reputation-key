// Portal analytics tab — KPI cards + shadcn charts for portal-scoped metrics
// Uses: ChartContainer, FunnelChart (engagement funnel), BarChart (distribution), AreaChart (rating trend)

import { useState, useEffect } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { getPortalAnalyticsFn } from '#/contexts/dashboard/server/portal-analytics'
import { TIME_RANGE_OPTIONS, type TimeRangePreset } from '#/contexts/dashboard/application/dto/dashboard.dto'
import type { PortalAnalyticsData } from '#/contexts/dashboard/domain/types'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '#/components/ui/chart'
import { KPICard } from '#/components/features/property/property-dashboard-helpers'
import { ScanLine, Star, MessageCircle, MousePointerClick, BarChart3 } from 'lucide-react'
import { Bar, BarChart, XAxis, YAxis, Area, AreaChart, CartesianGrid, Funnel, FunnelChart, LabelList, Cell } from 'recharts'

type Props = Readonly<{
  portalId: string
  propertyId: string
}>

const TIME_RANGE_KEY = 'portal-analytics-time-range'

export function PortalAnalyticsTab({ portalId, propertyId }: Props) {
  const [timeRange, setTimeRange] = useState<TimeRangePreset>(() => {
    if (typeof window === 'undefined') return 'all'
    return (localStorage.getItem(TIME_RANGE_KEY) as TimeRangePreset) ?? 'all'
  })
  const [data, setData] = useState<PortalAnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const analyticsFn = useServerFn(getPortalAnalyticsFn)

  useEffect(() => {
    localStorage.setItem(TIME_RANGE_KEY, timeRange)
  }, [timeRange])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    analyticsFn({ data: { propertyId, portalId, timeRange } })
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message ?? 'Failed to load analytics')
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [propertyId, portalId, timeRange])

  const handleTimeRangeChange = (value: string) => {
    setTimeRange(value as TimeRangePreset)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading analytics…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  if (!data) return null

  // Empty state: no metrics at all
  const hasData = data.kpis.scans.value > 0 || data.kpis.feedback.value > 0 ||
    data.kpis.reviewLinkClicks.value > 0 || data.kpis.avgRating.value > 0

  if (!hasData) {
    return (
      <div className="space-y-6">
        <TimeRangePicker timeRange={timeRange} onChange={handleTimeRangeChange} />
        <div className="rounded-lg border border-dashed p-12 text-center">
          <BarChart3 className="mx-auto size-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-semibold">No data yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Share your portal to start collecting metrics.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <TimeRangePicker timeRange={timeRange} onChange={handleTimeRangeChange} />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPICard label="Scans" kpi={data.kpis.scans} icon={ScanLine} />
        <KPICard
          label="Avg Rating"
          kpi={data.kpis.avgRating}
          icon={Star}
          formatValue={(v) => v.toFixed(1)}
        />
        <KPICard label="Feedback" kpi={data.kpis.feedback} icon={MessageCircle} />
        <KPICard label="Review Clicks" kpi={data.kpis.reviewLinkClicks} icon={MousePointerClick} />
      </div>

      {/* Charts — 2-column grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Engagement Funnel — full width */}
        <ChartCard title="Engagement Funnel" className="md:col-span-2">
          <EngagementFunnelChart funnel={data.engagementFunnel} />
        </ChartCard>

        {/* Rating Distribution */}
        <ChartCard title="Rating Distribution">
          <RatingDistributionChart distribution={data.ratingDistribution} />
        </ChartCard>

        {/* Rating Trend — full width if present, otherwise distribution takes full */}
        {data.ratingTrend.length > 0 && (
          <ChartCard title="Rating Trend">
            <RatingTrendChart trend={data.ratingTrend} />
          </ChartCard>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────

function TimeRangePicker({ timeRange, onChange }: { timeRange: TimeRangePreset; onChange: (v: string) => void }) {
  return (
    <div className="flex justify-end">
      <Tabs
        value={timeRange}
        onValueChange={onChange}
        className="min-w-0 shrink-0"
      >
        <TabsList className="flex-wrap">
          {TIME_RANGE_OPTIONS.map((opt) => (
            <TabsTrigger key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}

function ChartCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border bg-muted/30 p-4 ${className ?? ''}`}>
      <h3 className="mb-3 text-sm font-semibold tracking-tight">{title}</h3>
      {children}
    </div>
  )
}

// ─── Charts ────────────────────────────────────────────────────

const funnelConfig = {
  scans: { label: 'Scans', color: 'var(--chart-1)' },
  ratings: { label: 'Ratings', color: 'var(--chart-2)' },
  reviewLinkClicks: { label: 'Review Clicks', color: 'var(--chart-3)' },
} satisfies ChartConfig

function EngagementFunnelChart({ funnel }: { funnel: { scans: number; ratings: number; reviewLinkClicks: number } }) {
  const data = [
    { value: funnel.scans, name: 'Scans', fill: 'var(--color-scans)' },
    { value: funnel.ratings, name: 'Ratings', fill: 'var(--color-ratings)' },
    { value: funnel.reviewLinkClicks, name: 'Review Clicks', fill: 'var(--color-reviewLinkClicks)' },
  ]

  return (
    <ChartContainer config={funnelConfig} className="min-h-[250px] w-full">
      <FunnelChart>
        <ChartTooltip content={<ChartTooltipContent />} />
        <Funnel
          dataKey="value"
          data={data}
          isAnimationActive
        >
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

function RatingDistributionChart({ distribution }: { distribution: readonly { stars: number; count: number }[] }) {
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

function RatingTrendChart({ trend }: { trend: readonly { date: string; avgRating: number }[] }) {
  const data = trend.map((p) => ({
    date: p.date,
    avgRating: Math.round(p.avgRating * 10) / 10,
  }))

  return (
    <ChartContainer config={trendConfig} className="min-h-[250px] w-full">
      <AreaChart data={data} margin={{ left: 0, right: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={(v: string) => {
          const d = new Date(v)
          return `${d.getMonth() + 1}/${d.getDate()}`
        }} />
        <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} tickLine={false} axisLine={false} />
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
