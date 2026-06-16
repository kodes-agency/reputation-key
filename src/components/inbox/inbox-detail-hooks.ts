// Inbox detail sub-hooks — split from use-inbox-detail.ts for line-count
// compliance. useDetailData owns the fetch lifecycle; useAutoMarkRead owns
// the debounced mark-as-read effect.

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

export type DetailData = Readonly<{
  detail: InboxItemDetail | null
  notes: ReadonlyArray<InboxNote>
  isLoading: boolean
  error: string | null
  reload: () => Promise<void>
  setDetail: React.Dispatch<React.SetStateAction<InboxItemDetail | null>>
}>

/** Owns the detail + notes fetch lifecycle. `reload` is stable (reads the
 *  current item from a ref) so callers can safely capture it in long-lived
 *  callbacks (e.g. a mutation's onSuccess). */
export function useDetailData(item: InboxItem | null, active: boolean): DetailData {
  const [detail, setDetail] = useState<InboxItemDetail | null>(null)
  const [notes, setNotes] = useState<ReadonlyArray<InboxNote>>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const detailAction = useAction(useServerFn(getInboxItemDetailFn))
  const notesAction = useAction(useServerFn(getInboxNotesFn))

  // Refs keep the latest actions + item so loadDetail can stay stable.
  const refs = useRef({ abort: false, detailAction, notesAction, item })
  refs.current.detailAction = detailAction
  refs.current.notesAction = notesAction
  refs.current.item = item

  const loadDetail = useCallback(async () => {
    const current = refs.current.item
    if (!current) return
    refs.current.abort = false
    setError(null)
    setIsLoading(true)
    try {
      const [detailResult, notesResult] = await Promise.all([
        refs.current.detailAction({ data: { inboxItemId: current.id } }),
        refs.current.notesAction({ data: { inboxItemId: current.id } }),
      ])
      if (!refs.current.abort) {
        if (detailResult) setDetail(detailResult)
        if (notesResult) setNotes(notesResult)
      }
    } catch {
      if (!refs.current.abort) setError('Failed to load detail. Try again.')
    } finally {
      if (!refs.current.abort) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (active && item) {
      loadDetail()
    } else {
      setDetail(null)
      setNotes([])
    }
    return () => {
      refs.current.abort = true
    }
  }, [active, item?.id, loadDetail])

  return { detail, notes, isLoading, error, reload: loadDetail, setDetail }
}

/** Debounced auto-mark-as-read for newly-opened 'new' items. Calls
 *  `onMarkedRead` (updates local detail + bumps statusVersion) on success. */
export function useAutoMarkRead(
  item: InboxItem | null,
  active: boolean,
  enabled: boolean | undefined,
  onMarkedRead: () => void,
): string | null {
  const markReadMutation = useMutationAction(updateInboxStatusFn, {
    onSuccess: onMarkedRead,
  })
  const markReadRef = useRef(markReadMutation)
  markReadRef.current = markReadMutation
  const lastMarkedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !active || !item) return
    if (lastMarkedRef.current === item.id) return
    // FE-2: skip already-read items (and any other non-'new' status) so we
    // don't fire a redundant markRead mutation — that would trigger an
    // unnecessary server call plus side effects (toast, query invalidation).
    if (item.status === 'read') return
    if (item.status !== 'new') return

    const timer = setTimeout(() => {
      lastMarkedRef.current = item.id
      markReadRef.current({ data: { inboxItemId: item.id, status: 'read' } })
    }, 500)
    return () => clearTimeout(timer)
  }, [enabled, active, item])

  return lastMarkedRef.current
}
