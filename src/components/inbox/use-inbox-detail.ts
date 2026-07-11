// Shared hook for inbox item detail data fetching.
// Used by the inbox page for both the desktop inline panel and the mobile sheet.
//
// Reads via TanStack Query; mutations invalidate inboxKeys.detail(id) — a PREFIX
// of notes/activity — so one invalidate refreshes all three. The async BullMQ
// activity row (inserted ~2s after a status change) is caught by a delayed
// re-invalidate of the activity query. No statusVersion / refreshKey / manual
// refetch orchestration — Query owns cache, dedup, and cancellation.
import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import type { Action } from '#/components/hooks/use-action'
import { inboxKeys } from '#/shared/queries/query-keys'
import type { updateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import type { InboxServerFns } from './types'
import type {
  InboxItem,
  InboxItemDetailResult,
  InboxNote,
} from '#/contexts/inbox/application/public-api'
import { useAutoMarkRead } from './inbox-detail-hooks'

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
    'getInboxItemDetail' | 'getInboxNotes' | 'updateInboxStatus'
  >,
  options?: UseInboxDetailOptions,
): InboxDetailState {
  const qc = useQueryClient()
  const { autoMarkRead, onItemStatusChanged } = options ?? {}
  const id = item?.id ?? ''
  const enabled = active && !!item

  const detailQuery = useQuery({
    queryKey: inboxKeys.detail(id),
    queryFn: () => inboxFns.getInboxItemDetail({ data: { inboxItemId: id } }),
    enabled,
    staleTime: 0,
  })
  const notesQuery = useQuery({
    queryKey: inboxKeys.notes(id),
    queryFn: () => inboxFns.getInboxNotes({ data: { inboxItemId: id } }),
    enabled,
    staleTime: 0,
  })

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
      qc.invalidateQueries({ queryKey: inboxKeys.newCount() })
      onItemStatusChanged?.(updated)
    },
    [qc, id, onItemStatusChanged],
  )

  // A reply mutation (submit/approve/reject/etc.) writes the new reply straight
  // into the detail cache so revisiting the item shows it without a refetch —
  // the mutation output is authoritative. Keeps the optimistic local state + cache in sync.
  const onReplyMutated = useCallback(
    (reply: InboxItemDetailResult['reply']) => {
      // Optimistic: write the new reply into the detail cache so the active view
      // reflects it instantly. Then invalidate so the server (source of truth)
      // repopulates the whole detail incl. reply — guarantees a revisit shows it
      // even when the query isn't otherwise refetched.
      qc.setQueryData<InboxItemDetailResult>(inboxKeys.detail(id), (old) =>
        old ? { ...old, reply } : old,
      )
      qc.invalidateQueries({ queryKey: inboxKeys.detail(id) })
    },
    [qc, id],
  )

  const lastMarkedId = useAutoMarkRead(
    item,
    active,
    autoMarkRead,
    handleStatusChanged,
    inboxFns.updateInboxStatus,
  )

  const updateStatus = useActionMutation(inboxFns.updateInboxStatus, {
    successMessage: 'Status updated',
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
    lastMarkedId,
  }
}
