// The History tab: reads the merged ledger and the versions, holds what is open,
// and makes a version live again. Everything it draws is `PortalHistoryView`.
//
// The ledger is one infinite read per filter; the versions are one read that
// the ledger joins (which version an edit went into, what each version added).
// Making a version live again invalidates the Portal's detail, which holds
// both reads, so the lines, the rail and the header's status all follow.

import { useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { Action } from '#/components/hooks/use-action'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import { portalKeys } from '#/shared/queries/query-keys'
import type { getPortalHistory } from '#/contexts/portal/server/portals'
import type {
  getPortalVersion,
  getPortalVersionPreview,
  getPortalVersions,
} from '#/contexts/portal/server/portal-versions'
import { buildHistoryRows, type HistoryFilterKey } from './portal-history-rows'
import { PortalHistoryView, type HistorySelection } from './portal-history-view'
import { PortalVersionPreview } from './portal-version-preview'
import { useNow } from './use-now'

/** The reads, handed in by the route (components never import server modules). */
export type PortalHistoryReads = Readonly<{
  getHistory: typeof getPortalHistory
  getVersions: typeof getPortalVersions
  getVersion: typeof getPortalVersion
  /** One version's guest page, for "View". */
  getVersionPreview: typeof getPortalVersionPreview
}>

export type MakeVersionLiveAction = Action<
  { data: { portalId: string; version: number } },
  unknown
>

const PAGE_SIZE = 50
const STALE_MS = 10_000

type Props = Readonly<{
  portalId: string
  portalName: string
  /** The property's IANA zone: its days are what "yesterday" means. */
  timeZone: string
  /** Changes the draft holds, from the publication history the header reads. */
  pendingChangeCount: number
  /** The viewer holds `portal.update` and `portal.write`. */
  mayMakeLive: boolean
  /** The page is on: only a live page has a version to switch. */
  pageIsLive: boolean
  reads: PortalHistoryReads
  makeLive: MakeVersionLiveAction
}>

// fallow-ignore-next-line complexity
export function PortalHistoryTab({
  portalId,
  portalName,
  timeZone,
  pendingChangeCount,
  mayMakeLive,
  pageIsLive,
  reads,
  makeLive,
}: Props) {
  const now = useNow()
  const [filter, setFilter] = useState<HistoryFilterKey>('all')
  const [showEarlier, setShowEarlier] = useState(false)
  const [selection, setSelection] = useState<HistorySelection | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [revealedVersion, setRevealedVersion] = useState<number | null>(null)
  const [restoredVersion, setRestoredVersion] = useState<number | null>(null)

  const history = useInfiniteQuery({
    queryKey: portalKeys.historyFor(portalId, filter),
    queryFn: ({ pageParam }) =>
      reads.getHistory({
        data: {
          portalId,
          filter,
          limit: PAGE_SIZE,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: STALE_MS,
  })
  const versions = useQuery({
    queryKey: portalKeys.versions(portalId),
    queryFn: () => reads.getVersions({ data: { portalId } }),
    staleTime: STALE_MS,
  })
  const detail = useQuery({
    queryKey: portalKeys.version(portalId, selection?.version ?? 0),
    queryFn: () =>
      reads.getVersion({ data: { portalId, version: selection?.version ?? 0 } }),
    enabled: selection !== null,
    // What would change depends on what is live right now, so it is never reused.
    staleTime: 0,
  })

  const entries = useMemo(
    () => history.data?.pages.flatMap((page) => page.entries) ?? [],
    [history.data],
  )
  const rows = useMemo(
    () =>
      buildHistoryRows({
        entries,
        versions: versions.data ?? null,
        filter,
        showEarlier,
      }),
    [entries, versions.data, filter, showEarlier],
  )

  const select = (next: HistorySelection | null) => {
    setRestoreError(null)
    setRestoredVersion(null)
    setSelection(next)
  }
  const confirmRestore = async (version: number) => {
    setRestoreError(null)
    try {
      await makeLive({ data: { portalId, version } })
      setRestoredVersion(version)
      setSelection(null)
    } catch (error) {
      setRestoreError(actionErrorMessage(error))
    }
  }

  return (
    <PortalHistoryView
      portalName={portalName}
      now={now}
      timeZone={timeZone}
      filter={filter}
      onFilterChange={(next) => {
        setFilter(next)
        setRevealedVersion(null)
        select(null)
      }}
      rows={rows}
      entriesState={history.isPending ? 'loading' : history.isError ? 'error' : 'ready'}
      hasMore={history.hasNextPage}
      loadingMore={history.isFetchingNextPage}
      onLoadMore={() => void history.fetchNextPage()}
      onRetry={() => void history.refetch()}
      onShowEarlier={(firstVersion) => {
        setRevealedVersion(firstVersion)
        setShowEarlier(true)
      }}
      revealedVersion={revealedVersion}
      restoredVersion={restoredVersion}
      announcement={
        restoredVersion === null ? null : `Version ${restoredVersion} is live again.`
      }
      versions={versions.data ?? null}
      versionsFailed={versions.isError}
      pendingChangeCount={pendingChangeCount}
      canMakeLive={mayMakeLive && pageIsLive}
      note={
        pageIsLive || versions.data?.versions.length === 0
          ? null
          : 'No version is live while the page is off. Turn it on from Review & publish to make a version live again.'
      }
      selection={selection}
      versionPreview={
        selection === null ? null : (
          <PortalVersionPreview
            // Another version is another page: its language and state start over.
            key={selection.version}
            portalId={portalId}
            version={selection.version}
            getVersionPreview={reads.getVersionPreview}
          />
        )
      }
      detail={{
        status: detail.isError ? 'error' : detail.data ? 'ready' : 'loading',
        detail: detail.data ?? null,
        retry: () => void detail.refetch(),
      }}
      submitting={makeLive.isPending}
      restoreError={restoreError}
      onSelect={select}
      onConfirmRestore={(version) => void confirmRestore(version)}
    />
  )
}
