// Shared hook for inbox item detail data fetching
// Used by the inbox page for both the desktop inline panel and the mobile sheet.

import { useEffect, useState, useCallback, useRef } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import {
  getInboxItemDetailFn,
  getInboxNotesFn,
  updateInboxStatusFn,
} from '#/contexts/inbox/server/inbox'
import type {
  InboxItem,
  InboxItemDetail,
  InboxNote,
} from '#/contexts/inbox/application/public-api'

export type InboxDetailState = Readonly<{
  detail: InboxItemDetail | null
  notes: ReadonlyArray<InboxNote>
  isLoading: boolean
  currentItem: InboxItem | null
  updateStatus: ReturnType<typeof useMutationAction<typeof updateInboxStatusFn>>
  refresh: () => void
}>

export function useInboxDetail(
  item: InboxItem | null,
  active: boolean,
): InboxDetailState {
  const [detail, setDetail] = useState<InboxItemDetail | null>(null)
  const [notes, setNotes] = useState<ReadonlyArray<InboxNote>>([])
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const abortRef = useRef(false)

  const detailAction = useAction(useServerFn(getInboxItemDetailFn))
  const notesAction = useAction(useServerFn(getInboxNotesFn))

  // Keep action refs current to avoid stale closures in loadDetail
  const detailActionRef = useRef(detailAction)
  detailActionRef.current = detailAction
  const notesActionRef = useRef(notesAction)
  notesActionRef.current = notesAction

  const loadDetail = useCallback(async () => {
    if (!item) return
    abortRef.current = false
    setIsLoadingDetail(true)
    try {
      const [detailResult, notesResult] = await Promise.all([
        detailActionRef.current({ data: { inboxItemId: item.id } }),
        notesActionRef.current({ data: { inboxItemId: item.id } }),
      ])
      if (!abortRef.current) {
        if (detailResult) setDetail(detailResult)
        if (notesResult) setNotes(notesResult)
      }
    } catch {
      // Error is on detailAction.error
    } finally {
      if (!abortRef.current) setIsLoadingDetail(false)
    }
  }, [item?.id])

  useEffect(() => {
    if (active && item) {
      loadDetail()
    } else {
      setDetail(null)
      setNotes([])
    }
    return () => {
      abortRef.current = true
    }
  }, [active, item?.id, loadDetail])

  const loadDetailRef = useRef(loadDetail)
  loadDetailRef.current = loadDetail

  const updateStatus = useMutationAction(updateInboxStatusFn, {
    successMessage: 'Status updated',
    onSuccess: () => {
      void loadDetailRef.current()
    },
  })

  return {
    detail,
    notes,
    isLoading: isLoadingDetail,
    currentItem: detail?.item ?? item,
    updateStatus,
    refresh: loadDetail,
  }
}
