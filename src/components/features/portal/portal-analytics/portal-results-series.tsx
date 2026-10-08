// "Over time": the weekly chart with its heading, its reading and its values.
import { useId } from 'react'
import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import { chartModel, type ChartModel } from './portal-results-chart-model'
import { PortalResultsSeriesChart } from './portal-results-series-chart'
import { PortalResultsSeriesTable } from './portal-results-series-table'
import { currentPeriodLabel, priorPeriodLabel } from './portal-results-window'

function describe(data: PortalAnalyticsData, model: ChartModel): string {
  const last = data.series?.weeks.at(-1)
  const parts = ['Qualified scans per week, with the average private rating above.']
  if (last !== undefined && last.days < 7) {
    parts.push(`The last bars cover ${last.days} ${last.days === 1 ? 'day' : 'days'}.`)
  }
  // Said once here; the weeks themselves carry only a hollow marker.
  if (model.hasBelowFloor) {
    parts.push(
      `Weeks with fewer than ${data.thresholds.averageMinSample} ratings show no average.`,
    )
  }
  return parts.join(' ')
}

export function PortalResultsSeries({
  data,
  comparing,
}: Readonly<{
  data: PortalAnalyticsData
  comparing: boolean
}>) {
  const headingId = useId()
  const { series } = data
  // Named from the days the figures cover, not from the range picked a moment
  // ago: while a new range loads the old bars are still on screen.
  const rangeLabel =
    data.localDays === null ? 'This period' : currentPeriodLabel(data.localDays)
  const priorLabel =
    data.localDays === null ? 'The period before' : priorPeriodLabel(data.localDays)
  const model = series === null ? null : chartModel(series, data.versionMarkers)
  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3">
      <h3 id={headingId} className="text-base font-semibold">
        Over time
      </h3>
      {series === null || model === null ? (
        <p className="text-sm text-muted-foreground">
          Weekly figures need a chosen range. All time shows totals only.
        </p>
      ) : (
        <>
          <PortalResultsSeriesChart
            model={model}
            rangeLabel={rangeLabel}
            priorLabel={priorLabel}
            description={describe(data, model)}
            labelledBy={headingId}
          />
          <PortalResultsSeriesTable
            series={series}
            versionMarkers={data.versionMarkers}
            showPrior={comparing}
            priorLabel={priorLabel}
          />
        </>
      )}
    </section>
  )
}
