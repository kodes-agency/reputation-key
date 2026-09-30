// "Guests by language" (board 07): private ratings by the language of the page
// the guest saw. A new measure, so the board tags it.
import { Badge } from '#/components/ui/badge'
import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import { languageRows, languagesAreHeldBack } from './portal-results-languages'

export function PortalResultsLanguages({
  breakdown,
  ratingsState,
  headingId,
}: Readonly<{
  breakdown: PortalAnalyticsData['ratingLanguages']
  /** State of the governed ratings count the languages are captioned against. */
  ratingsState: PortalAnalyticsData['kpis']['ratings']['evidence']['state']
  headingId: string
}>) {
  const heldBack = languagesAreHeldBack(ratingsState)
  const { rows, caption } = languageRows(breakdown)
  return (
    <div className="space-y-3">
      <h3 id={headingId} className="flex items-center gap-2 text-base font-semibold">
        Guests by language
        <Badge variant="secondary" className="font-normal">
          New measure
        </Badge>
      </h3>
      {heldBack || rows.length === 0 ? null : (
        <ol aria-labelledby={headingId} className="space-y-2.5">
          {rows.map((row) => (
            <li
              key={row.key}
              className="grid grid-cols-[minmax(5.5rem,7rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm"
            >
              <span className="truncate">{row.label}</span>
              <span aria-hidden="true" className="h-2 rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-foreground/70"
                  style={{ width: `${row.barPercent}%` }}
                />
              </span>
              <span className="min-w-20 text-right tabular-nums">{row.detail}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="text-sm text-muted-foreground">
        {heldBack ? 'Languages appear once the ratings are counted.' : caption}
      </p>
    </div>
  )
}
