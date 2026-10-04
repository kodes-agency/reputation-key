import { useEffect, useState } from 'react'
import type { PropertyGooglePerformanceReportV1 } from '#/shared/google-performance-report-contract'
import {
  dashboardRangeComparisonLabel,
  toPerformancePreset,
  type DashboardRange,
} from '#/shared/dashboard-range'
import { StatusBadge, type StatusMap } from '#/components/ui/status-badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { ExplainTrigger } from '#/components/ui/explain-trigger'
import { DescriptionItem, DescriptionList } from '#/components/ui/description-list'
import { MetricStrip } from '#/components/ui/metric-strip'
import { Popover, PopoverContent } from '#/components/ui/popover'
import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import { formatDateTime } from '#/lib/format-date-time'
import { formatLocalDate } from '#/lib/format'
import { GooglePerformanceChart } from './google-performance-chart'
import {
  GooglePerformanceHeadlines,
  GooglePerformanceMetric,
} from './google-performance-metrics'

const SOURCE_STATUS: StatusMap<
  PropertyGooglePerformanceReportV1['sourceHealth']['state']
> = {
  ready: { label: 'Current', tone: 'positive' },
  partial: { label: 'Partial coverage', tone: 'warn' },
  no_data: { label: 'No data returned', tone: 'neutral' },
  delayed: { label: 'Delayed', tone: 'warn' },
  stale: { label: 'Stale', tone: 'warn' },
}

/** A stored day for a sentence; the raw day if it cannot be read as one. */
const dayText = (localDate: string, options?: Readonly<{ year?: boolean }>): string =>
  formatLocalDate(localDate, options) ?? localDate

export function formatGoogleFreshness(retrievedAt: string, now = new Date()): string {
  const retrievedAtMs = Date.parse(retrievedAt)
  if (!Number.isFinite(retrievedAtMs)) return 'recently'

  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - retrievedAtMs) / 1_000))
  if (elapsedSeconds < 60) return 'just now'

  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) {
    return `${elapsedHours} ${elapsedHours === 1 ? 'hour' : 'hours'} ago`
  }

  const elapsedDays = Math.floor(elapsedHours / 24)
  return `${elapsedDays} ${elapsedDays === 1 ? 'day' : 'days'} ago`
}

function useFreshnessClock(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  return now
}

export function GooglePerformanceSourceStatus({
  report,
}: Readonly<{ report: PropertyGooglePerformanceReportV1 }>) {
  const now = useFreshnessClock()
  const status = SOURCE_STATUS[report.sourceHealth.state]
  const statusLabel = status.label
  const completeThrough = report.sourceHealth.latestCompleteCoreLocalDate
  const dataThrough =
    completeThrough ??
    report.sourceHealth.latestReturnedDataLocalDate ??
    report.sourceHealth.providerCheckedThroughLocalDate
  const coverageLabel = completeThrough ? 'Google data through' : 'Google checked through'
  const freshness = formatGoogleFreshness(report.retrievedAt, now)
  const markText = `${freshness} · ${coverageLabel} ${dayText(dataThrough, { year: false })}`
  const dateTimeOptions = {
    locale: 'en-US',
    timeZone: report.period.timezone,
    timeZoneName: true,
  } as const

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {report.sourceHealth.state !== 'ready' ? <StatusBadge {...status} /> : null}
      <div className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1 text-sm text-muted-foreground">
        <GlossaryTerm term="updated">Updated</GlossaryTerm>
        <Popover>
          <ExplainTrigger
            className="text-left"
            aria-label={`Google source details. ${statusLabel}. Updated ${markText}`}
          >
            {markText}
          </ExplainTrigger>
          <PopoverContent
            align="start"
            aria-label="Google source details"
            className="w-[min(22rem,calc(100vw-2rem))]"
          >
            <p className="font-medium">Google source details</p>
            <DescriptionList aria-label="Google source details" className="mt-3 gap-2">
              <DescriptionItem term="Status">{statusLabel}</DescriptionItem>
              <DescriptionItem term="Source">{report.sourceLabel}</DescriptionItem>
              <DescriptionItem term="Retrieved">
                <time dateTime={report.retrievedAt}>
                  {formatDateTime(new Date(report.retrievedAt), dateTimeOptions)}
                </time>
              </DescriptionItem>
              <DescriptionItem term="Timezone">{report.period.timezone}</DescriptionItem>
              <DescriptionItem term="Period">
                {dayText(report.period.currentStartLocalDate)}–
                {dayText(report.period.currentEndLocalDate)}
              </DescriptionItem>
              <DescriptionItem term="Data lag">
                {report.sourceHealth.dataLagDays === null
                  ? 'No complete Google day was returned.'
                  : `${report.sourceHealth.dataLagDays} ${
                      report.sourceHealth.dataLagDays === 1 ? 'day' : 'days'
                    }`}
              </DescriptionItem>
              <DescriptionItem term="Report expires">
                <time dateTime={report.contentExpiresAt}>
                  {formatDateTime(new Date(report.contentExpiresAt), dateTimeOptions)}
                </time>
              </DescriptionItem>
              <DescriptionItem term="Lease expires">
                <time dateTime={report.authorizationLease.expiresAt}>
                  {formatDateTime(
                    new Date(report.authorizationLease.expiresAt),
                    dateTimeOptions,
                  )}
                </time>
              </DescriptionItem>
            </DescriptionList>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

export function GooglePerformanceReport({
  report,
  range,
}: Readonly<{
  report: PropertyGooglePerformanceReportV1
  range: DashboardRange
}>) {
  // The report compares the window with the one just before it, at the length
  // Google can serve (`all` is clamped to the six months it reaches back).
  const comparisonLabel =
    dashboardRangeComparisonLabel(toPerformancePreset(range)) ?? 'vs the previous period'
  const hasAdditionalInteractions = report.additionalInteractions.some(
    (metric) => metric.value !== null && metric.value !== 0,
  )

  return (
    <div className="flex flex-col gap-6">
      <GooglePerformanceHeadlines report={report} comparisonLabel={comparisonLabel} />
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <GooglePerformanceChart
          title="How people found you"
          description="Search and Maps profile views by device."
          valueLabel="profile views"
          range={range}
          series={report.discoverySeries}
        />
        <GooglePerformanceChart
          title="What people did"
          description="Website, call, direction, and conversation actions."
          valueLabel="actions"
          range={range}
          series={report.actionSeries}
        />
      </div>
      {hasAdditionalInteractions ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-lg font-semibold tracking-tight">
                Additional interactions
              </h2>
            </CardTitle>
            <CardDescription>
              Other actions reported by Google for this period.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MetricStrip
              aria-label="Additional Google interactions"
              variant="tiles"
              columns={3}
            >
              {report.additionalInteractions.map((metric) => (
                <GooglePerformanceMetric
                  key={metric.label}
                  metric={metric}
                  comparisonLabel={comparisonLabel}
                />
              ))}
            </MetricStrip>
          </CardContent>
        </Card>
      ) : null}
      <details className="rounded-lg border px-4">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">
          About these numbers
        </summary>
        <p className="pb-4 text-xs leading-relaxed text-muted-foreground">
          Profile impressions count profile views on Search and Maps. Call clicks count
          clicks on the call action, not completed calls. Google may omit zero or
          unavailable daily values; RepKey does not estimate them.
        </p>
      </details>
    </div>
  )
}
