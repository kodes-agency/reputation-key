// Shared hook for inbox item detail data fetching.
// Used by the inbox page for both the desktop inline panel and the mobile sheet.
// Receives server fns as a param per src/components/CONTEXT.md:55.
// Fetch lifecycle + auto-mark-read live in inbox-detail-hooks.ts.
import { useState } from 'react'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import type { updateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import type { InboxServerFns } from './types'
import type {
  InboxItem,
  InboxItemDetailResult,
  InboxNote,
} from '#/contexts/inbox/application/public-api'
import { useDetailData, useAutoMarkRead } from './inbox-detail-hooks'

export type UseInboxDetailOptions = Readonly<{
  autoMarkRead?: boolean
}>

export type InboxDetailState = Readonly<{
  detail: InboxItemDetailResult | null
  notes: ReadonlyArray<InboxNote>
  isLoading: boolean
  currentItem: InboxItem | null
  updateStatus: ReturnType<typeof useMutationAction<typeof updateInboxStatusFn>>
  refresh: () => void
  /** Called after a note is added: re-fetches detail/notes and bumps
   *  statusVersion so the activity timeline refreshes (refreshKey = statusVersion). */
  onNoteAdded: () => void
  error: string | null
  lastMarkedId: string | null
  /** Bumped every time a status update completes and detail reloads.
   *  Parent can watch this + currentItem to sync the list. */
  statusVersion: number
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
  const [statusVersion, setStatusVersion] = useState(0)
  const { detail, notes, isLoading, error, reload, setDetail } = useDetailData(
    item,
    active,
    inboxFns.getInboxItemDetail,
    inboxFns.getInboxNotes,
  )

  const lastMarkedId = useAutoMarkRead(
    item,
    active,
    options?.autoMarkRead,
    () => {
      // Update local state directly — no re-fetch needed.
      // Avoids triggering isLoading (skeleton flash).
      setDetail((prev) =>
        prev?.item
          ? {
              ...prev,
              item: { ...prev.item, status: 'read' as const, updatedAt: new Date() },
            }
          : prev,
      )
      setStatusVersion((v) => v + 1)
    },
    inboxFns.updateInboxStatus,
  )

  const updateStatus = useMutationAction(inboxFns.updateInboxStatus, {
    successMessage: 'Status updated',
    invalidate: false,
    onSuccess: () => {
      void reload().then(() => {
        setStatusVersion((v) => v + 1)
      })
    },
  })

  return {
    detail,
    notes,
    isLoading,
    currentItem: detail?.item ?? item,
    updateStatus,
    refresh: reload,
    onNoteAdded: () => {
      void reload().then(() => setStatusVersion((v) => v + 1))
    },
    error,
    lastMarkedId,
    statusVersion,
  }
}
