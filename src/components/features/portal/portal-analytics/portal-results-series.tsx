// "Over time": the weekly chart with its heading, its reading and its values.
import { useId } from 'react'
import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import type { TimeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'
import { chartModel } from './portal-results-chart-model'
import { PortalResultsSeriesChart } from './portal-results-series-chart'
import { PortalResultsSeriesTable } from './portal-results-series-table'
import { PORTAL_RESULTS_RANGES } from './portal-results-window'

function describe(data: PortalAnalyticsData): string {
  const last = data.series?.weeks.at(-1)
  const base = 'Qualified scans per week, with the average private rating above.'
  return last !== undefined && last.days < 7
    ? `${base} The last bars cover ${last.days} ${last.days === 1 ? 'day' : 'days'}.`
    : base
}

export function PortalResultsSeries({
  data,
  timeRange,
  comparing,
}: Readonly<{
  data: PortalAnalyticsData
  timeRange: TimeRangePreset
  comparing: boolean
}>) {
  const headingId = useId()
  const { series } = data
  const rangeLabel =
    PORTAL_RESULTS_RANGES.find((range) => range.value === timeRange)?.label ??
    'This period'
  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3">
      <h3 id={headingId} className="text-base font-semibold">
        Over time
      </h3>
      {series === null ? (
        <p className="text-sm text-muted-foreground">
          Weekly figures need a chosen range. All time shows totals only.
        </p>
      ) : (
        <>
          <PortalResultsSeriesChart
            model={chartModel(series, data.versionMarkers)}
            rangeLabel={rangeLabel}
            description={describe(data)}
            labelledBy={headingId}
          />
          <PortalResultsSeriesTable series={series} showPrior={comparing} />
        </>
      )}
    </section>
  )
}
