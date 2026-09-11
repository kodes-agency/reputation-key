import { useEffect, useState, type ReactNode } from 'react'
import type { PropertyGooglePerformanceReportV1 } from '#/shared/google-performance-report-contract'
import type { DashboardRange } from '#/shared/dashboard-range'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import { formatDateTime } from '#/lib/format-date-time'
import { GooglePerformanceChart } from './google-performance-chart'
import {
  GooglePerformanceHeadlines,
  GooglePerformanceMetric,
} from './google-performance-metrics'

const SOURCE_STATUS_LABELS: Readonly<
  Record<PropertyGooglePerformanceReportV1['sourceHealth']['state'], string>
> = {
  ready: 'Current',
  partial: 'Partial coverage',
  no_data: 'No data returned',
  delayed: 'Delayed',
  stale: 'Stale',
}

const MONTH_DAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
function formatLocalDate(localDate: string, includeYear = false): string {
  const date = new Date(`${localDate}T00:00:00.000Z`)
  return (includeYear ? FULL_DATE_FORMATTER : MONTH_DAY_FORMATTER).format(date)
}

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

function SourceDetail({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-pretty">{children}</dd>
    </div>
  )
}

export function GooglePerformanceSourceStatus({
  report,
}: Readonly<{ report: PropertyGooglePerformanceReportV1 }>) {
  const now = useFreshnessClock()
  const statusLabel = SOURCE_STATUS_LABELS[report.sourceHealth.state]
  const completeThrough = report.sourceHealth.latestCompleteCoreLocalDate
  const dataThrough =
    completeThrough ??
    report.sourceHealth.latestReturnedDataLocalDate ??
    report.sourceHealth.providerCheckedThroughLocalDate
  const coverageLabel = completeThrough ? 'Google data through' : 'Google checked through'
  const freshness = formatGoogleFreshness(report.retrievedAt, now)
  const markText = `${freshness} · ${coverageLabel} ${formatLocalDate(dataThrough)}`
  const dateTimeOptions = {
    locale: 'en-US',
    timeZone: report.period.timezone,
    timeZoneName: true,
  } as const

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {report.sourceHealth.state !== 'ready' ? (
        <Badge variant="outline">{statusLabel}</Badge>
      ) : null}
      <div className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1 text-sm text-muted-foreground">
        <GlossaryTerm term="updated">Updated</GlossaryTerm>
        <Popover>
          <PopoverTrigger
            className="rounded text-left underline decoration-dotted decoration-from-font underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-label={`Google source details. ${statusLabel}. Updated ${markText}`}
          >
            {markText}
          </PopoverTrigger>
          <PopoverContent
            align="start"
            aria-label="Google source details"
            className="w-[min(22rem,calc(100vw-2rem))]"
          >
            <p className="font-medium">Google source details</p>
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <SourceDetail label="Status">{statusLabel}</SourceDetail>
              <SourceDetail label="Source">{report.sourceLabel}</SourceDetail>
              <SourceDetail label="Retrieved">
                <time dateTime={report.retrievedAt}>
                  {formatDateTime(new Date(report.retrievedAt), dateTimeOptions)}
                </time>
              </SourceDetail>
              <SourceDetail label="Timezone">{report.period.timezone}</SourceDetail>
              <SourceDetail label="Period">
                {formatLocalDate(report.period.currentStartLocalDate, true)}–
                {formatLocalDate(report.period.currentEndLocalDate, true)}
              </SourceDetail>
              <SourceDetail label="Data lag">
                {report.sourceHealth.dataLagDays === null
                  ? 'No complete Google day was returned.'
                  : `${report.sourceHealth.dataLagDays} ${
                      report.sourceHealth.dataLagDays === 1 ? 'day' : 'days'
                    }`}
              </SourceDetail>
              <SourceDetail label="Report expires">
                <time dateTime={report.contentExpiresAt}>
                  {formatDateTime(new Date(report.contentExpiresAt), dateTimeOptions)}
                </time>
              </SourceDetail>
              <SourceDetail label="Lease expires">
                <time dateTime={report.authorizationLease.expiresAt}>
                  {formatDateTime(
                    new Date(report.authorizationLease.expiresAt),
                    dateTimeOptions,
                  )}
                </time>
              </SourceDetail>
            </dl>
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
  const hasAdditionalInteractions = report.additionalInteractions.some(
    (metric) => metric.value !== null && metric.value !== 0,
  )

  return (
    <div className="flex flex-col gap-6">
      <GooglePerformanceHeadlines report={report} />
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
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {report.additionalInteractions.map((metric) => (
              <GooglePerformanceMetric key={metric.label} metric={metric} />
            ))}
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
