import type { ReactNode } from 'react'
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
import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import { cn } from '#/lib/utils'

const numberFormat = new Intl.NumberFormat()

function MetricDelta({ metric }: Readonly<{ metric: PerformanceMetricValue }>) {
  const coverage =
    metric.availability === 'partial'
      ? `${metric.completeDayCount} current / ${metric.priorCompleteDayCount} prior complete days`
      : null

  let delta: ReactNode
  if (metric.availability === 'not_applicable_or_not_returned') {
    delta = <span>Not applicable or not returned by Google</span>
  } else if (metric.availability === 'no_complete_days') {
    delta = <span>No complete days in this period</span>
  } else if (metric.deltaPercent === null) {
    delta = <span>No comparable period</span>
  } else {
    const rounded = Math.abs(metric.deltaPercent).toFixed(1)
    const Icon =
      metric.deltaPercent > 0
        ? ArrowUpRight
        : metric.deltaPercent < 0
          ? ArrowDownRight
          : Minus
    const direction =
      metric.deltaPercent > 0 ? 'up' : metric.deltaPercent < 0 ? 'down' : 'unchanged'

    delta = (
      <span
        className={cn(
          'inline-flex items-center gap-1',
          metric.deltaPercent > 0 && 'text-positive',
          metric.deltaPercent < 0 && 'text-destructive',
        )}
      >
        <Icon aria-hidden="true" className="size-3.5" />
        {direction === 'unchanged' ? 'Unchanged' : `${direction} ${rounded}%`} vs prior
        period
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      {delta}
      {coverage ? <span>{coverage}</span> : null}
    </div>
  )
}

export function GooglePerformanceMetric({
  metric,
  label,
}: Readonly<{ metric: PerformanceMetricValue; label?: ReactNode }>) {
  return (
    <div className="flex min-w-0 flex-col gap-2 p-4 sm:p-5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label ?? metric.label}</p>
        {metric.availability === 'partial' ? (
          <Badge variant="outline">Partial</Badge>
        ) : null}
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
        {metric.value === null ? 'Not returned' : numberFormat.format(metric.value)}
      </p>
      <MetricDelta metric={metric} />
    </div>
  )
}

export function GooglePerformanceHeadlines({
  report,
}: Readonly<{ report: PropertyGooglePerformanceReportV1 }>) {
  const metrics: ReadonlyArray<{
    metric: PerformanceMetricValue
    label?: ReactNode
  }> = [
    {
      metric: report.headlines.totalProfileImpressions,
      label: <GlossaryTerm term="profile-views">Profile views</GlossaryTerm>,
    },
    { metric: report.headlines.websiteClicks },
    { metric: report.headlines.callClicks },
    { metric: report.headlines.directionRequests },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold tracking-tight">At a glance</h2>
        </CardTitle>
        <CardDescription>
          Complete property-local days compared with the preceding period.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-1 divide-y sm:grid-cols-2 sm:[&>*:nth-child(2n)]:border-l lg:grid-cols-4 lg:divide-y-0 lg:[&>*]:border-l lg:[&>*:first-child]:border-l-0">
          {metrics.map(({ metric, label }) => (
            <GooglePerformanceMetric key={metric.label} metric={metric} label={label} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
