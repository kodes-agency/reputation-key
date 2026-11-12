// The ledger: the filter pill, then one timeline of rows, newest first. It reads
// the entries and the versions they join, and says itself while they load or if
// the entries cannot be read.

import { useMemo } from 'react'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import { PAGE_GUTTER_X } from '#/components/layout/page-shell'
import { LoadMoreButton } from '#/components/ui/load-more-button'
import { RegionError } from '#/components/ui/region-error'
import { Skeleton } from '#/components/ui/skeleton'
import { Timeline } from '#/components/ui/timeline'
import { cn } from '#/lib/utils'
import { PortalHistoryEarlierRow } from './portal-history-earlier-row'
import { PortalHistoryFilters } from './portal-history-filters'
import { PortalHistoryRow } from './portal-history-row'
import { usePortalHistory } from './portal-history-context'
import { buildHistoryRows, type HistoryFilterKey } from './portal-history-rows'
import { useHistoryEntries, useHistoryVersions } from './use-portal-history-reads'

const EMPTY_TEXT: Readonly<Record<HistoryFilterKey, string>> = {
  all: 'Nothing has happened to this portal yet.',
  publishing: 'Nothing has been published yet.',
  codes: 'No code has been made or downloaded yet.',
  edits: 'No page edits yet.',
}

const PAGE_OFF_NOTE =
  'No version is live while the page is off. Turn it on from Review & publish to make a version live again.'

export function PortalHistoryLedger() {
  const { portalName, filter, showEarlier, pageIsLive } = usePortalHistory()
  const history = useHistoryEntries()
  const versions = useHistoryVersions()
  const state = hasFailed(history) ? 'error' : history.isPending ? 'loading' : 'ready'
  const rows = useMemo(
    () =>
      buildHistoryRows({
        entries: history.data?.pages.flatMap((page) => page.entries) ?? [],
        versions: versions.data ?? null,
        filter,
        showEarlier,
      }),
    [history.data, versions.data, filter, showEarlier],
  )
  // Why no version can be made live, quietly under the filters.
  const note = pageIsLive || versions.data?.versions.length === 0 ? null : PAGE_OFF_NOTE
  return (
    <section
      aria-labelledby="portal-ledger-title"
      className={cn(PAGE_GUTTER_X, 'min-w-0 flex-1 py-5')}
    >
      <h2 id="portal-ledger-title" className="sr-only">
        History of {portalName}
      </h2>
      <PortalHistoryFilters />
      {note ? <p className="mt-3 text-sm text-muted-foreground">{note}</p> : null}
      <div className="mt-5">
        {state === 'loading' ? (
          <div className="space-y-4" aria-hidden="true">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-8 w-full" />
            ))}
          </div>
        ) : null}
        {state === 'error' ? (
          <RegionError
            size="compact"
            message="The history couldn’t be loaded."
            onRetry={() => void history.refetch()}
            retrying={isRetrying(history)}
          />
        ) : null}
        {state === 'ready' && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{EMPTY_TEXT[filter]}</p>
        ) : null}
        {state === 'ready' && rows.length > 0 ? (
          <Timeline role="list" aria-label="History, newest first">
            {rows.map((row) =>
              row.kind === 'earlier_versions' ? (
                <PortalHistoryEarlierRow key={row.key} versions={row.versions} />
              ) : (
                <PortalHistoryRow key={row.key} row={row} />
              ),
            )}
          </Timeline>
        ) : null}
        {state === 'ready' && history.hasNextPage ? (
          <LoadMoreButton
            className="mt-4"
            label="Load earlier activity"
            loading={history.isFetchingNextPage}
            onLoadMore={() => void history.fetchNextPage()}
          />
        ) : null}
      </div>
    </section>
  )
}
