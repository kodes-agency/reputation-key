// Portal analytics tab — KPI cards + charts for portal-scoped metrics

import { useState, useEffect } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { getPortalAnalyticsFn } from '#/contexts/dashboard/server/portal-analytics'
import type { PortalAnalyticsData } from '#/contexts/dashboard/server/portal-analytics'
import {
  TIME_RANGE_OPTIONS,
  type TimeRangePreset,
} from '#/contexts/dashboard/application/dto/dashboard.dto'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { KPICard } from '#/components/features/property/property-dashboard-helpers'
import { ScanLine, Star, MessageCircle, MousePointerClick, BarChart3 } from 'lucide-react'
import {
  ChartCard,
  EngagementFunnelChart,
  RatingDistributionChart,
  RatingTrendChart,
} from './portal-analytics-charts'

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

    return () => {
      cancelled = true
    }
  }, [propertyId, portalId, timeRange])

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

  const hasData =
    data.kpis.scans.value > 0 ||
    data.kpis.feedback.value > 0 ||
    data.kpis.reviewLinkClicks.value > 0 ||
    data.kpis.avgRating.value > 0

  if (!hasData) {
    return (
      <div className="space-y-6">
        <TimeRangePicker
          timeRange={timeRange}
          onChange={(v) => setTimeRange(v as TimeRangePreset)}
        />
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
      <TimeRangePicker
        timeRange={timeRange}
        onChange={(v) => setTimeRange(v as TimeRangePreset)}
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPICard label="Scans" kpi={data.kpis.scans} icon={ScanLine} />
        <KPICard
          label="Avg Rating"
          kpi={data.kpis.avgRating}
          icon={Star}
          formatValue={(v: number) => v.toFixed(1)}
        />
        <KPICard label="Feedback" kpi={data.kpis.feedback} icon={MessageCircle} />
        <KPICard
          label="Review Clicks"
          kpi={data.kpis.reviewLinkClicks}
          icon={MousePointerClick}
        />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ChartCard title="Engagement Funnel" className="md:col-span-2">
          <EngagementFunnelChart funnel={data.engagementFunnel} />
        </ChartCard>
        <ChartCard title="Rating Distribution">
          <RatingDistributionChart distribution={data.ratingDistribution} />
        </ChartCard>
        {data.ratingTrend.length > 0 && (
          <ChartCard title="Rating Trend">
            <RatingTrendChart trend={data.ratingTrend} />
          </ChartCard>
        )}
      </div>
    </div>
  )
}

function TimeRangePicker({
  timeRange,
  onChange,
}: {
  timeRange: TimeRangePreset
  onChange: (v: string) => void
}) {
  return (
    <div className="flex justify-end">
      <Tabs value={timeRange} onValueChange={onChange} className="min-w-0 shrink-0">
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
