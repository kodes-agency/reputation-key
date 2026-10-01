// The ledger: the filter pill, then one timeline of rows, newest first. It
// draws what it is given. The inline confirmation of a publish line is passed
// in as a render prop, because it owns its own read and write.

import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { Timeline } from '#/components/ui/timeline'
import { PortalHistoryEarlierRow } from './portal-history-earlier-row'
import { PortalHistoryFilters } from './portal-history-filters'
import { PortalHistoryRow } from './portal-history-row'
import type { HistoryFilterKey, HistoryRow } from './portal-history-rows'

const EMPTY_TEXT: Readonly<Record<HistoryFilterKey, string>> = {
  all: 'Nothing has happened to this portal yet.',
  publishing: 'Nothing has been published yet.',
  codes: 'No code has been made or downloaded yet.',
  edits: 'No page edits yet.',
}

type Props = Readonly<{
  rows: readonly HistoryRow[]
  state: 'loading' | 'error' | 'ready'
  filter: HistoryFilterKey
  onFilterChange: (filter: HistoryFilterKey) => void
  portalName: string
  now: Date
  timeZone: string
  /** The viewer may make a version live again, and the page is on. */
  canMakeLive: boolean
  /** The version whose confirmation is open on its own line. */
  restoreVersion: number | null
  renderRestore: (version: number) => ReactNode
  onView: (version: number) => void
  onAskRestore: (version: number) => void
  onShowEarlier: () => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onRetry: () => void
  /** A quiet line under the filters, e.g. why no version can be made live. */
  note?: ReactNode
}>

export function PortalHistoryLedger(props: Props) {
  const { rows, state, filter, onFilterChange, timeZone, note } = props
  return (
    <section
      aria-labelledby="portal-ledger-title"
      className="min-w-0 flex-1 px-4 py-5 md:px-6"
    >
      <h2 id="portal-ledger-title" className="sr-only">
        History of {props.portalName}
      </h2>
      <PortalHistoryFilters
        filter={filter}
        onFilterChange={onFilterChange}
        timeZone={timeZone}
      />
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
          <div role="alert" className="text-sm">
            <p className="text-destructive">The history could not be loaded.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={props.onRetry}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {state === 'ready' && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{EMPTY_TEXT[filter]}</p>
        ) : null}
        {state === 'ready' && rows.length > 0 ? (
          <Timeline role="list" aria-label="History, newest first">
            {rows.map((row) =>
              row.kind === 'earlier_versions' ? (
                <PortalHistoryEarlierRow
                  key={row.key}
                  versions={row.versions}
                  now={props.now}
                  timeZone={timeZone}
                  onShow={props.onShowEarlier}
                />
              ) : (
                <PortalHistoryRow
                  key={row.key}
                  row={row}
                  portalName={props.portalName}
                  now={props.now}
                  timeZone={timeZone}
                  canMakeLive={props.canMakeLive}
                  restoreOpen={
                    row.version !== null && row.version.version === props.restoreVersion
                  }
                  onView={props.onView}
                  onAskRestore={props.onAskRestore}
                  restorePanel={
                    row.version !== null && row.version.version === props.restoreVersion
                      ? props.renderRestore(row.version.version)
                      : null
                  }
                />
              ),
            )}
          </Timeline>
        ) : null}
        {state === 'ready' && props.hasMore ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            disabled={props.loadingMore}
            onClick={props.onLoadMore}
          >
            {props.loadingMore ? 'Loading…' : 'Load earlier activity'}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
