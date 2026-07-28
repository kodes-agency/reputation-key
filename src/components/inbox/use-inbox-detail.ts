// Shared hook for inbox item detail data fetching.
// Used by the inbox page for both the desktop inline panel and the mobile sheet.
//
// Reads via TanStack Query; all invalidation policy (prefix topology, BullMQ
// activity lag, folder-cache staleness, reply-poll predicate) lives in the
// InboxCachePolicy module (./inbox-cache-policy) — this hook is wiring only:
// Query owns cache, dedup, and cancellation.
import { useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import type { Action } from '#/components/hooks/use-action'
import { inboxKeys } from '#/shared/queries/query-keys'
import { inboxCachePolicy, replyRefetchInterval } from './inbox-cache-policy'
import type {
  updateInboxStatusFn,
  escalateInboxItemFn,
  resolveEscalationFn,
} from '#/contexts/inbox/server/inbox'
import type { InboxServerFns } from './types'
import type {
  InboxItem,
  InboxItemDetailResult,
  InboxNote,
} from '#/contexts/inbox/application/public-api'

export type UseInboxDetailOptions = Readonly<{
  autoMarkRead?: boolean
  /** Called with the updated item after a status change (mark-read / escalate /
   *  archive). The inbox page wires it to the optimistic list sync (instant UI
   *  update + drop-from-filter), replacing the old statusVersion effect. */
  onItemStatusChanged?: (updated: InboxItem) => void
}>

export type InboxDetailState = Readonly<{
  detail: InboxItemDetailResult | null
  /** Retry on error — refetches detail + notes via Query. */
  refetch: () => void
  notes: ReadonlyArray<InboxNote>
  isLoading: boolean
  currentItem: InboxItem | null
  updateStatus: Action<
    Parameters<typeof updateInboxStatusFn>[0],
    Awaited<ReturnType<typeof updateInboxStatusFn>>
  >
  escalate: Action<
    Parameters<typeof escalateInboxItemFn>[0],
    Awaited<ReturnType<typeof escalateInboxItemFn>>
  >
  resolveEscalation: Action<
    Parameters<typeof resolveEscalationFn>[0],
    Awaited<ReturnType<typeof resolveEscalationFn>>
  >
  /** Called after a note is added — refreshes notes + activity. */
  onNoteAdded: () => void
  /** Called after a reply mutation — writes the new reply into the detail cache. */
  onReplyMutated: (reply: InboxItemDetailResult['reply']) => void
  error: string | null
  lastMarkedId: string | null
}>

/** Detail + notes queries and their result shaping (loading/error/refetch). */
function useInboxDetailQueries(
  inboxFns: Pick<InboxServerFns, 'getInboxItemDetail' | 'getInboxNotes'>,
  id: string,
  enabled: boolean,
  fallbackItem: InboxItem | null,
) {
  const detailQuery = useQuery({
    queryKey: inboxKeys.detail(id),
    queryFn: () => inboxFns.getInboxItemDetail({ data: { inboxItemId: id } }),
    enabled,
    staleTime: 0,
    // Poll while a reply publish is pending (approved → published happens
    // asynchronously via BullMQ) — the predicate lives in the cache policy.
    refetchInterval: (query) => replyRefetchInterval(query.state.data?.reply),
  })
  const notesQuery = useQuery({
    queryKey: inboxKeys.notes(id),
    queryFn: () => inboxFns.getInboxNotes({ data: { inboxItemId: id } }),
    enabled,
    staleTime: 0,
  })

  const detail = detailQuery.data ?? null
  return {
    detail,
    notes: notesQuery.data ?? [],
    isLoading: detailQuery.isLoading || notesQuery.isLoading,
    currentItem: detail?.item ?? fallbackItem,
    error: detailQuery.error ? 'Failed to load detail. Try again.' : null,
    refetch: () => {
      void detailQuery.refetch()
      void notesQuery.refetch()
    },
    /** Live item status — feeds auto-close detection while polling. */
    polledStatus: detailQuery.data?.item.status,
  }
}

/** Detect a server-side status transition (auto-close during reply-publish polling). */
function useInboxAutoCloseDetection(
  qc: QueryClient,
  polledStatus: string | undefined,
): void {
  const prevStatusRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (prevStatusRef.current && prevStatusRef.current !== polledStatus) {
      inboxCachePolicy.onItemFolderChanged(qc)
    }
    prevStatusRef.current = polledStatus
  }, [polledStatus, qc])
}

/** The three status mutations sharing one success handler (policy + list sync). */
function useInboxStatusMutations(
  inboxFns: Pick<
    InboxServerFns,
    'updateInboxStatus' | 'escalateInboxItem' | 'resolveEscalation'
  >,
  qc: QueryClient,
  id: string,
  onItemStatusChanged?: (updated: InboxItem) => void,
) {
  // Notify the policy about the status change, then the list for the
  // optimistic sync (instant UI update + drop-from-filter).
  const handleStatusChanged = useCallback(
    (updated: InboxItem) => {
      inboxCachePolicy.onStatusChanged(qc, id)
      onItemStatusChanged?.(updated)
    },
    [qc, id, onItemStatusChanged],
  )
  const updateStatus = useActionMutation(inboxFns.updateInboxStatus, {
    successMessage: 'Status updated',
    onSuccess: handleStatusChanged,
  })
  const escalate = useActionMutation(inboxFns.escalateInboxItem, {
    successMessage: 'Escalated',
    onSuccess: handleStatusChanged,
  })
  const resolveEscalation = useActionMutation(inboxFns.resolveEscalation, {
    successMessage: 'Escalation resolved',
    onSuccess: handleStatusChanged,
  })
  return { updateStatus, escalate, resolveEscalation }
}

export function useInboxDetail(
  item: InboxItem | null,
  active: boolean,
  inboxFns: Pick<
    InboxServerFns,
    | 'getInboxItemDetail'
    | 'getInboxNotes'
    | 'updateInboxStatus'
    | 'escalateInboxItem'
    | 'resolveEscalation'
  >,
  options?: UseInboxDetailOptions,
): InboxDetailState {
  const qc = useQueryClient()
  const { onItemStatusChanged } = options ?? {}
  const id = item?.id ?? ''
  const enabled = active && !!item

  const queries = useInboxDetailQueries(inboxFns, id, enabled, item)
  useInboxAutoCloseDetection(qc, queries.polledStatus)
  const mutations = useInboxStatusMutations(inboxFns, qc, id, onItemStatusChanged)

  // A reply mutation (submit/approve/reject/publish) — the policy writes the
  // reply through to the detail cache and refreshes the stale folder caches.
  const onReplyMutated = useCallback(
    (reply: InboxItemDetailResult['reply']) => {
      inboxCachePolicy.onReplyMutated(qc, id, reply)
    },
    [qc, id],
  )

  return {
    detail: queries.detail,
    notes: queries.notes,
    isLoading: queries.isLoading,
    currentItem: queries.currentItem,
    updateStatus: mutations.updateStatus,
    escalate: mutations.escalate,
    resolveEscalation: mutations.resolveEscalation,
    refetch: queries.refetch,
    onNoteAdded: () => inboxCachePolicy.onNoteAdded(qc, id),
    onReplyMutated,
    error: queries.error,
    lastMarkedId: null,
  }
}
