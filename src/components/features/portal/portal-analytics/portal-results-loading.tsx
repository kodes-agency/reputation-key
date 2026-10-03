// The Results tab while its first read is on the way: the strip with every
// cell named, and a block where the funnel and the weekly view will be. The
// Portals overview prints the same strip while its figures load.
import { Skeleton } from '#/components/ui/skeleton'
import { PortalResultsLoadingStrip } from './portal-results-strip'

export function PortalResultsLoading() {
  return (
    <div className="@container space-y-8" role="status" aria-busy="true">
      <span className="sr-only">Loading results…</span>
      <PortalResultsLoadingStrip />
      <div className="grid gap-x-10 gap-y-10 @4xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}
