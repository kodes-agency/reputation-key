// The History tab's four reads, one hook each, so a part awaits only its own:
// the ledger (an infinite read per filter), the versions it joins, the
// publication history that counts the draft's changes, and one version opened
// for viewing or restoring. Making a version live again invalidates the
// Portal's detail, which holds all of them.

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import { portalKeys } from '#/shared/queries/query-keys'
import type { PortalVersionDetail } from '#/contexts/portal/application/portal-management-contracts'
import { usePortalHistory } from './portal-history-context'

const PAGE_SIZE = 50
const STALE_MS = 10_000
const PUBLICATION_HISTORY_STALE_MS = 30_000

export function useHistoryEntries() {
  const { portalId, filter, reads } = usePortalHistory()
  return useInfiniteQuery({
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
}

export function useHistoryVersions() {
  const { portalId, reads } = usePortalHistory()
  return useQuery({
    queryKey: portalKeys.versions(portalId),
    queryFn: () => reads.getVersions({ data: { portalId } }),
    staleTime: STALE_MS,
  })
}

/** The same read the workspace header and the Page tab use, under the same key. */
export function useHistoryPublication() {
  const { portalId, reads } = usePortalHistory()
  return useQuery({
    queryKey: portalKeys.publicationHistory(portalId),
    queryFn: () => reads.getPublicationHistory({ data: { portalId } }),
    staleTime: PUBLICATION_HISTORY_STALE_MS,
  })
}

export type HistoryDetailState = Readonly<{
  status: 'loading' | 'error' | 'ready'
  detail: PortalVersionDetail | null
  retry: () => void
  /** `retry` is reading; the failure stays, its button busy. */
  retrying: boolean
}>

/** One version, read when it is opened. What would change depends on what is live now, so it is never reused. */
export function useVersionDetail(version: number): HistoryDetailState {
  const { portalId, reads } = usePortalHistory()
  const detail = useQuery({
    queryKey: portalKeys.version(portalId, version),
    queryFn: () => reads.getVersion({ data: { portalId, version } }),
    staleTime: 0,
  })
  return {
    status: hasFailed(detail) ? 'error' : detail.data ? 'ready' : 'loading',
    detail: detail.data ?? null,
    retry: () => void detail.refetch(),
    retrying: isRetrying(detail),
  }
}
