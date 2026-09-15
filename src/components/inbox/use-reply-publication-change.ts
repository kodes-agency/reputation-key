import { useCallback, useEffect, useRef } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { InboxItemDetailResult } from '#/contexts/inbox/application/public-api'
import {
  inboxCachePolicy,
  observeReplyPublication,
  polledReplyPublicationChanged,
  type ReplyPublicationObservation,
} from './inbox-cache-policy'

type DetailReply = InboxItemDetailResult['reply']

/**
 * D8: a detail poll that sees its reply change status or publication state
 * (sending → ambiguous, ambiguous → published/terminal, ...) may have moved the
 * item between queues, and nothing else refreshes the lists or counts: list
 * polling only runs while a loaded row needs it. The returned callback records a
 * reply mutation's own result, which `onReplyChanged` already refreshed, so a
 * write-through patch is not mistaken for a polled transition.
 */
export function useReplyPublicationChangeDetection(
  qc: QueryClient,
  id: string,
  reply: DetailReply | undefined,
) {
  const previous = useRef<ReplyPublicationObservation | null>(null)
  useEffect(() => {
    if (reply === undefined) return
    const current = observeReplyPublication(id, reply)
    if (polledReplyPublicationChanged(previous.current, current)) {
      inboxCachePolicy.onPolledReplyChanged(qc)
    }
    previous.current = current
  }, [id, qc, reply])
  return useCallback(
    (accepted: DetailReply) => {
      previous.current = observeReplyPublication(id, accepted)
    },
    [id],
  )
}
