// Shared hook for inbox item detail data fetching.
// Used by the inbox page for both the desktop inline panel and the mobile sheet.
//
// Reads via TanStack Query; mutations invalidate inboxKeys.detail(id) — a PREFIX
// of notes/activity — so one invalidate refreshes all three. The async BullMQ
// activity row (inserted ~2s after a status change) is caught by a delayed
// re-invalidate of the activity query. No statusVersion / refreshKey / manual
// refetch orchestration — Query owns cache, dedup, and cancellation.
import { useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import type { Action } from '#/components/hooks/use-action'
import { inboxKeys } from '#/shared/queries/query-keys'
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

  const detailQuery = useQuery({
    queryKey: inboxKeys.detail(id),
    queryFn: () => inboxFns.getInboxItemDetail({ data: { inboxItemId: id } }),
    enabled,
    staleTime: 0,
    // Poll while a reply publish is pending (approved → published happens
    // asynchronously via BullMQ). Stops as soon as the reply leaves 'approved'.
    refetchInterval: (query) => {
      const reply = query.state.data?.reply
      return reply && reply.status === 'approved' ? 3000 : false
    },
  })
  const notesQuery = useQuery({
    queryKey: inboxKeys.notes(id),
    queryFn: () => inboxFns.getInboxNotes({ data: { inboxItemId: id } }),
    enabled,
    staleTime: 0,
  })

  // When the detail query polls (refetchInterval) during a pending reply
  // publish, the inbox item may auto-close (open→closed) server-side. Detect
  // that transition and invalidate the list + counts so the UI reflects it
  // without a manual refresh.
  const prevStatusRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const currentStatus = detailQuery.data?.item.status
    if (prevStatusRef.current && prevStatusRef.current !== currentStatus) {
      qc.invalidateQueries({ queryKey: inboxKeys.lists() })
      qc.invalidateQueries({ queryKey: inboxKeys.counts() })
      qc.invalidateQueries({ queryKey: inboxKeys.lastVisitCount() })
    }
    prevStatusRef.current = currentStatus
  }, [detailQuery.data?.item.status, qc])

  // Invalidate detail (prefix → notes + activity) and re-invalidate activity on
  // a delay to catch the BullMQ-inserted row (~2s). Notify the list for the
  // optimistic sync. Targeted — never router.invalidate().
  const handleStatusChanged = useCallback(
    (updated: InboxItem) => {
      qc.invalidateQueries({ queryKey: inboxKeys.detail(id) })
      setTimeout(() => qc.invalidateQueries({ queryKey: inboxKeys.activity(id) }), 2500)
      // A status change moves the item between folders → sibling list caches,
      // folder-count badges, and the global new-count badge are all stale.
      qc.invalidateQueries({ queryKey: inboxKeys.lists() })
      qc.invalidateQueries({ queryKey: inboxKeys.counts() })
      qc.invalidateQueries({ queryKey: inboxKeys.lastVisitCount() })
      onItemStatusChanged?.(updated)
    },
    [qc, id, onItemStatusChanged],
  )

  // A reply mutation (submit/approve/reject/publish) writes the new reply straight
  // into the detail cache so revisiting the item shows it without a refetch.
  // Publishing a reply also auto-closes the inbox item server-side (via the
  // on-reply-published event handler), so we MUST invalidate the list + counts
  // to reflect the status change (open → closed).
  const onReplyMutated = useCallback(
    (reply: InboxItemDetailResult['reply']) => {
      qc.setQueryData<InboxItemDetailResult>(inboxKeys.detail(id), (old) =>
        old ? { ...old, reply } : old,
      )
      qc.invalidateQueries({ queryKey: inboxKeys.detail(id) })
      qc.invalidateQueries({ queryKey: inboxKeys.lists() })
      qc.invalidateQueries({ queryKey: inboxKeys.counts() })
      qc.invalidateQueries({ queryKey: inboxKeys.lastVisitCount() })
    },
    [qc, id],
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

  const detail = detailQuery.data ?? null
  const notes = notesQuery.data ?? []

  return {
    detail,
    notes,
    isLoading: detailQuery.isLoading || notesQuery.isLoading,
    currentItem: detail?.item ?? item,
    updateStatus,
    escalate,
    resolveEscalation,
    refetch: () => {
      void detailQuery.refetch()
      void notesQuery.refetch()
    },
    onNoteAdded: () => {
      qc.invalidateQueries({ queryKey: inboxKeys.notes(id) })
      setTimeout(() => qc.invalidateQueries({ queryKey: inboxKeys.activity(id) }), 2500)
    },
    onReplyMutated,
    error: detailQuery.error ? 'Failed to load detail. Try again.' : null,
    lastMarkedId: null,
  }
}
