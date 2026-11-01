// "View chart values" (board 07): the chart's numbers as a table, and the days
// its version markers stand on as a list, so nothing the picture says is only in
// the picture.
import type {
  PortalResultsSeries,
  PortalVersionMarker,
} from '#/contexts/reporting/application/public-api'
import { markerLabel } from './portal-results-trend-model'
import { formatDayRange } from './portal-results-window'
import { formatNumber } from '#/lib/format'

function averageText(week: PortalResultsSeries['buckets'][number]): string {
  if (week.average !== null) return week.average.toFixed(1)
  return week.averageWithheld === 'below_floor' && (week.ratings ?? 0) > 0
    ? 'Too few'
    : '—'
}

const count = (value: number | null) => (value === null ? '—' : formatNumber(value))

export function PortalResultsSeriesTable({
  series,
  versionMarkers,
  showPrior,
  priorLabel,
}: Readonly<{
  series: PortalResultsSeries
  versionMarkers: readonly PortalVersionMarker[]
  showPrior: boolean
  /** The prior column's heading: "The 30 days before". */
  priorLabel: string
}>) {
  return (
    <div className="text-sm">
      <div className="overflow-x-auto pb-2">
        <table className="w-full min-w-md text-left text-xs">
          <caption className="sr-only">Scans, ratings and average by day or week</caption>
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="pr-4 pb-2 font-medium">
                {series.bucketDays === 1 ? 'Day' : 'Week'}
              </th>
              <th scope="col" className="pr-4 pb-2 text-right font-medium">
                Scans
              </th>
              {showPrior ? (
                <th scope="col" className="pr-4 pb-2 text-right font-medium">
                  {priorLabel}
                </th>
              ) : null}
              <th scope="col" className="pr-4 pb-2 text-right font-medium">
                Ratings
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Average
              </th>
            </tr>
          </thead>
          <tbody>
            {series.buckets.map((week) => (
              <tr key={week.index} className="border-t">
                <th scope="row" className="py-2 pr-4 font-normal">
                  {formatDayRange(week.startLocalDate, week.endLocalDate)}
                </th>
                <td className="py-2 pr-4 text-right tabular-nums">{count(week.scans)}</td>
                {showPrior ? (
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {count(week.priorScans)}
                  </td>
                ) : null}
                <td className="py-2 pr-4 text-right tabular-nums">
                  {count(week.ratings)}
                </td>
                <td className="py-2 text-right tabular-nums">{averageText(week)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {versionMarkers.length === 0 ? null : (
          <section aria-label="Page updates" className="pt-3">
            <p className="pb-1 text-xs font-medium text-muted-foreground">Page updates</p>
            <ul className="space-y-0.5 text-xs">
              {versionMarkers.map((marker) => (
                <li key={`v${marker.version}-${marker.localDate}`}>
                  {markerLabel(marker)}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
