// Shared hook for inbox item detail data fetching
// Used by the inbox page for both the desktop inline panel and the mobile sheet.
//
// NOTE: Imports updateInboxStatusFn from server/ per the CONTEXT.md exception
// for inbox-scoped data-fetching hooks. The hook is only used by the inbox page.
// Fetch lifecycle + auto-mark-read live in inbox-detail-hooks.ts.
import { useState } from 'react'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { updateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import type {
  InboxItem,
  InboxItemDetail,
  InboxNote,
} from '#/contexts/inbox/application/public-api'
import { useDetailData, useAutoMarkRead } from './inbox-detail-hooks'

export type UseInboxDetailOptions = Readonly<{
  autoMarkRead?: boolean
}>

export type InboxDetailState = Readonly<{
  detail: InboxItemDetail | null
  notes: ReadonlyArray<InboxNote>
  isLoading: boolean
  currentItem: InboxItem | null
  updateStatus: ReturnType<typeof useMutationAction<typeof updateInboxStatusFn>>
  refresh: () => void
  error: string | null
  lastMarkedId: string | null
  /** Bumped every time a status update completes and detail reloads.
   *  Parent can watch this + currentItem to sync the list. */
  statusVersion: number
}>

export function useInboxDetail(
  item: InboxItem | null,
  active: boolean,
  options?: UseInboxDetailOptions,
): InboxDetailState {
  const [statusVersion, setStatusVersion] = useState(0)
  const { detail, notes, isLoading, error, reload, setDetail } = useDetailData(
    item,
    active,
  )

  const lastMarkedId = useAutoMarkRead(item, active, options?.autoMarkRead, () => {
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
  })

  const updateStatus = useMutationAction(updateInboxStatusFn, {
    successMessage: 'Status updated',
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
    error,
    lastMarkedId,
    statusVersion,
  }
}
