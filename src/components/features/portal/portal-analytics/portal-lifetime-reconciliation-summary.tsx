import type { PortalLifetimeReconciliationState } from '#/contexts/dashboard/application/public-api'
import { portalLifetimeReconciliationPresentation } from './portal-lifetime-reconciliation-presentation'

type Props = Readonly<{
  state: PortalLifetimeReconciliationState
  timeZone: string
}>

export function PortalLifetimeReconciliationSummary({ state, timeZone }: Props) {
  const view = portalLifetimeReconciliationPresentation(state, undefined, timeZone)

  return (
    <details className="rounded-lg border bg-muted/20 p-4">
      <summary className="cursor-pointer text-sm font-semibold tracking-tight">
        All-time data status
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">{view.summary}</p>
      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Projection</dt>
          <dd className="mt-1 font-medium tabular-nums">{view.revision}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last consistency check</dt>
          <dd className="mt-1 font-medium tabular-nums">{view.lastCheck}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Anonymous baseline</dt>
          <dd className="mt-1 font-medium tabular-nums">{view.anonymousBaseline}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last retention checkpoint</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {view.lastRetentionCheckpoint}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">
        All Time is absolute. These totals do not create a prior-period comparison or a
        time trend.
      </p>
    </details>
  )
}
