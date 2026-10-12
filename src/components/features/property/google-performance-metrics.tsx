import type { ReactNode } from 'react'
import type {
  PerformanceMetricValue,
  PropertyGooglePerformanceReportV1,
} from '#/shared/google-performance-report-contract'
import { StatusBadge } from '#/components/ui/status-badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import { formatNumber } from '#/lib/format'
import { MetricDelta } from '#/components/ui/metric-delta'
import { Metric, MetricStrip, MetricValue } from '#/components/ui/metric-strip'

function MetricComparison({
  metric,
  comparisonLabel,
}: Readonly<{ metric: PerformanceMetricValue; comparisonLabel: string }>) {
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
    delta = (
      <MetricDelta
        value={metric.deltaPercent}
        unit="percent"
        comparisonLabel={comparisonLabel}
      />
    )
  }

  return (
    <span className="flex flex-col gap-1">
      {metric.availability === 'partial' ? (
        <StatusBadge tone="warn" label="Partial" />
      ) : null}
      {delta}
      {coverage ? <span>{coverage}</span> : null}
    </span>
  )
}

/** One Google measure: its figure, the change, and how many days it rests on. Drawn inside a `MetricStrip`. */
export function GooglePerformanceMetric({
  metric,
  label,
  comparisonLabel,
}: Readonly<{
  metric: PerformanceMetricValue
  label?: ReactNode
  /** Names the baseline of the change, e.g. "vs the previous 90 days". */
  comparisonLabel: string
}>) {
  return (
    <Metric label={label ?? metric.label}>
      <MetricValue
        value={metric.value === null ? 'Not returned' : formatNumber(metric.value)}
        detail={<MetricComparison metric={metric} comparisonLabel={comparisonLabel} />}
      />
    </Metric>
  )
}

export function GooglePerformanceHeadlines({
  report,
  comparisonLabel,
}: Readonly<{
  report: PropertyGooglePerformanceReportV1
  comparisonLabel: string
}>) {
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
        <MetricStrip aria-label="Google performance at a glance" variant="embedded">
          {metrics.map(({ metric, label }) => (
            <GooglePerformanceMetric
              key={metric.label}
              metric={metric}
              label={label}
              comparisonLabel={comparisonLabel}
            />
          ))}
        </MetricStrip>
      </CardContent>
    </Card>
  )
}
