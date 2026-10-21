// What the Inbox cache does once "Check on Google" has found the reply.
//
// Apart from `inboxCachePolicy` because that file is at its size limit and this
// is one thing: the close is not part of the check's own transaction, so the
// item is re-read while it lands.

import type { QueryClient } from '@tanstack/react-query'
import { inboxKeys } from '#/shared/queries/query-keys'
import {
  BULLMQ_ACTIVITY_LAG_MS,
  invalidateFolderCaches,
  invalidateHistory,
} from './inbox-cache-policy'

/**
 * When the item is re-read after a check found the reply on Google. The reply
 * is recorded, an outbox fact is queued and the Inbox consumer closes the item,
 * which takes a few seconds. Re-read at once (it may already be closed), then
 * after the usual worker lag, then once more with the thread and the folders,
 * which also covers a slow queue.
 */
export const GOOGLE_REPLY_CLOSE_REREAD_DELAYS_MS: ReadonlyArray<number> = [
  0,
  BULLMQ_ACTIVITY_LAG_MS,
  8000,
]

/**
 * The item is closing through the event path: re-read it a few times while that
 * lands. The detail read that sees the status change also reaches
 * `inboxCachePolicy.onItemFolderChanged`; the last read's thread and folder
 * invalidation is for the pane that is no longer observing.
 */
export function rereadAfterGoogleReplyFound(qc: QueryClient, itemId: string): void {
  const lastDelay = GOOGLE_REPLY_CLOSE_REREAD_DELAYS_MS.at(-1)
  for (const delay of GOOGLE_REPLY_CLOSE_REREAD_DELAYS_MS) {
    setTimeout(() => {
      qc.invalidateQueries({ queryKey: inboxKeys.detail(itemId), exact: true })
      if (delay !== lastDelay) return
      invalidateHistory(qc, itemId)
      invalidateFolderCaches(qc)
    }, delay)
  }
}
