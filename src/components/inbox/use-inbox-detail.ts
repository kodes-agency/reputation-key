// Shared hook for inbox item detail data fetching
// Used by the inbox page for both the desktop inline panel and the mobile sheet.

// Inbox detail hook — data fetching for the inbox detail panel.
//
// NOTE: Imports getInboxItemDetailFn, getInboxNotesFn, updateInboxStatusFn
// from server/ per the CONTEXT.md exception for inbox-scoped
// data-fetching hooks. The hook is only used by the inbox page.
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
  const [detail, setDetail] = useState<InboxItemDetail | null>(null)
  const [notes, setNotes] = useState<ReadonlyArray<InboxNote>>([])
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusVersion, setStatusVersion] = useState(0)
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
    setError(null)
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
      if (!abortRef.current) setError('Failed to load detail. Try again.')
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

  // Auto-mark as read (debounced 500ms)
  const markReadMutation = useMutationAction(updateInboxStatusFn, {
    onSuccess: () => {
      void loadDetailRef.current().then(() => {
        setStatusVersion((v) => v + 1)
      })
    },
  })
  const markReadRef = useRef(markReadMutation)
  markReadRef.current = markReadMutation
  const lastMarkedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!options?.autoMarkRead || !active || !item) return
    if (lastMarkedRef.current === item.id) return
    if (item.status !== 'new') return

    const timer = setTimeout(() => {
      lastMarkedRef.current = item.id
      markReadRef.current({ data: { inboxItemId: item.id, status: 'read' } })
    }, 500)
    return () => clearTimeout(timer)
  }, [options?.autoMarkRead, active, item])

  const updateStatus = useMutationAction(updateInboxStatusFn, {
    successMessage: 'Status updated',
    onSuccess: () => {
      void loadDetailRef.current().then(() => {
        setStatusVersion((v) => v + 1)
      })
    },
  })

  return {
    detail,
    notes,
    isLoading: isLoadingDetail,
    currentItem: detail?.item ?? item,
    updateStatus,
    refresh: loadDetail,
    error,
    lastMarkedId: lastMarkedRef.current,
    statusVersion,
  }
}
