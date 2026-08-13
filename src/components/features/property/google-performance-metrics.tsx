import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type {
  PerformanceMetricValue,
  PropertyGooglePerformanceReportV1,
} from '#/shared/google-performance-report-contract'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

const numberFormat = new Intl.NumberFormat()

function formatMetricValue(metric: PerformanceMetricValue): string {
  return metric.value === null ? 'Not returned' : numberFormat.format(metric.value)
}

function MetricDelta({ metric }: Readonly<{ metric: PerformanceMetricValue }>) {
  const coverage = `${metric.completeDayCount} current / ${metric.priorCompleteDayCount} prior complete days`
  if (metric.availability === 'not_applicable_or_not_returned') {
    return (
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>Not applicable or not returned by Google</span>
        <span>{coverage}</span>
      </div>
    )
  }
  if (metric.availability === 'no_complete_days') {
    return (
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>No complete days in this period</span>
        <span>{coverage}</span>
      </div>
    )
  }
  if (metric.deltaPercent === null) {
    return (
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>No comparable period</span>
        <span>{coverage}</span>
      </div>
    )
  }

  const rounded = Math.abs(metric.deltaPercent).toFixed(1)
  const Icon =
    metric.deltaPercent > 0
      ? ArrowUpRight
      : metric.deltaPercent < 0
        ? ArrowDownRight
        : Minus
  const direction =
    metric.deltaPercent > 0 ? 'up' : metric.deltaPercent < 0 ? 'down' : 'unchanged'

  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Icon aria-hidden="true" className="size-3.5" />
        {direction === 'unchanged' ? 'Unchanged' : `${direction} ${rounded}%`} vs prior
        period
      </span>
      <span>{coverage}</span>
    </div>
  )
}

export function GooglePerformanceMetric({
  metric,
}: Readonly<{ metric: PerformanceMetricValue }>) {
  return (
    <div className="flex min-w-0 flex-col gap-2 p-4 sm:p-5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{metric.label}</p>
        {metric.availability === 'partial' ? (
          <Badge variant="outline">Partial</Badge>
        ) : null}
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
        {formatMetricValue(metric)}
      </p>
      <MetricDelta metric={metric} />
    </div>
  )
}

export function GooglePerformanceHeadlines({
  report,
}: Readonly<{ report: PropertyGooglePerformanceReportV1 }>) {
  const metrics = [
    report.headlines.totalProfileImpressions,
    report.headlines.websiteClicks,
    report.headlines.callClicks,
    report.headlines.directionRequests,
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>At a glance</CardTitle>
        <CardDescription>
          Complete property-local days compared with the preceding period.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-1 divide-y sm:grid-cols-2 sm:[&>*:nth-child(2n)]:border-l lg:grid-cols-4 lg:divide-y-0 lg:[&>*]:border-l lg:[&>*:first-child]:border-l-0">
          {metrics.map((metric) => (
            <GooglePerformanceMetric key={metric.label} metric={metric} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
