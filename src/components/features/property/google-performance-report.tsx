import type { PropertyGooglePerformanceReportV1 } from '#/shared/google-performance-report-contract'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { GooglePerformanceChart } from './google-performance-chart'
import {
  GooglePerformanceHeadlines,
  GooglePerformanceMetric,
} from './google-performance-metrics'

function SourceStatus({
  report,
}: Readonly<{ report: PropertyGooglePerformanceReportV1 }>) {
  const statusLabel = {
    ready: 'Current',
    partial: 'Partial coverage',
    no_data: 'No data returned',
    delayed: 'Delayed',
    stale: 'Stale',
  }[report.sourceHealth.state]

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
      <Badge variant={report.sourceHealth.state === 'ready' ? 'secondary' : 'outline'}>
        {statusLabel}
      </Badge>
      <span>Source: {report.sourceLabel}</span>
      <span>
        Retrieved{' '}
        <time dateTime={report.retrievedAt}>
          {new Date(report.retrievedAt).toLocaleString()}
        </time>
      </span>
      <span>Timezone: {report.period.timezone}</span>
      <span>
        Period: {report.period.currentStartLocalDate}–{report.period.currentEndLocalDate}
      </span>
      {report.sourceHealth.dataLagDays !== null ? (
        <span>
          Google data lag: {report.sourceHealth.dataLagDays}{' '}
          {report.sourceHealth.dataLagDays === 1 ? 'day' : 'days'}
        </span>
      ) : null}
      <span>
        Available until{' '}
        <time dateTime={report.contentExpiresAt}>
          {new Date(report.contentExpiresAt).toLocaleTimeString()}
        </time>
      </span>
    </div>
  )
}

export function GooglePerformanceReport({
  report,
}: Readonly<{ report: PropertyGooglePerformanceReportV1 }>) {
  return (
    <>
      <SourceStatus report={report} />
      <GooglePerformanceHeadlines report={report} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <GooglePerformanceChart
          title="How people found you"
          description="Search and Maps profile impressions by device."
          series={report.discoverySeries}
        />
        <GooglePerformanceChart
          title="Customer actions"
          description="Website, call, direction, and conversation actions."
          series={report.actionSeries}
        />
      </div>
      {report.additionalInteractions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Additional interactions</CardTitle>
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
      <p className="text-xs leading-relaxed text-muted-foreground">
        Profile impressions count profile views on Search and Maps. Call clicks count
        clicks on the call action, not completed calls. Google may omit zero or
        unavailable daily values; RepKey does not estimate them.
      </p>
    </>
  )
}
