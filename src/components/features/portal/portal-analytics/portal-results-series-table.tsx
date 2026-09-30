// "View chart values" (board 07): the chart's numbers as a table, and the days
// its version markers stand on as a list, so nothing the picture says is only in
// the picture.
import type {
  PortalResultsSeries,
  PortalVersionMarker,
} from '#/contexts/reporting/application/public-api'
import { markerLabel } from './portal-results-chart-model'
import { formatDayRange } from './portal-results-window'

function averageText(week: PortalResultsSeries['weeks'][number]): string {
  if (week.average !== null) return week.average.toFixed(1)
  return week.averageWithheld === 'below_floor' && (week.ratings ?? 0) > 0
    ? 'Too few'
    : '—'
}

const count = (value: number | null) =>
  value === null ? '—' : value.toLocaleString('en-US')

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
    <details className="group text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
        <span aria-hidden="true" className="transition-transform group-open:rotate-90">
          ›
        </span>
        View chart values
      </summary>
      <div className="overflow-x-auto pb-2">
        <table className="w-full min-w-md text-left text-xs">
          <caption className="sr-only">
            Qualified scans and average rating by week
          </caption>
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="pr-4 pb-2 font-medium">
                Week
              </th>
              <th scope="col" className="pr-4 pb-2 text-right font-medium">
                Qualified scans
              </th>
              {showPrior ? (
                <th scope="col" className="pr-4 pb-2 text-right font-medium">
                  {priorLabel}
                </th>
              ) : null}
              <th scope="col" className="pr-4 pb-2 text-right font-medium">
                Private ratings
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Average
              </th>
            </tr>
          </thead>
          <tbody>
            {series.weeks.map((week) => (
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
          <section aria-label="Version went live" className="pt-3">
            <h4 className="pb-1 text-xs font-medium text-muted-foreground">
              Version went live
            </h4>
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
    </details>
  )
}
