import { useId } from 'react'
import {
  portalResponseIntegrityCopy,
  type PortalResponseIntegritySummaryView,
} from './portal-response-integrity-copy'

export function PortalResponseIntegritySummary({
  summary,
}: {
  summary: PortalResponseIntegritySummaryView
}) {
  const headingId = useId()
  return (
    <section className="rounded-lg border bg-muted/30 p-4" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold tracking-tight">
        Response quality checks
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Private rating figures use accepted Portal responses, not unique guests. Hiding
        written feedback does not remove its star rating.
      </p>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Accepted</dt>
          <dd className="font-medium tabular-nums">
            {summary.accepted.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Filtered automatically</dt>
          <dd className="font-medium tabular-nums">
            {summary.filteredAutomatically.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Under review</dt>
          <dd className="font-medium tabular-nums">
            {summary.underReview.toLocaleString()}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        {portalResponseIntegrityCopy(summary)}
      </p>
    </section>
  )
}
