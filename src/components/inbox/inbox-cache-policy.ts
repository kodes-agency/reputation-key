// InboxCachePolicy — deep module owning the inbox cache-invalidation policy.
//
// The inbox hooks/pages no longer know:
//   - the query-key prefix topology (detail(id) ⊃ notes(id)/activity(id))
//   - the BullMQ activity-lag constant (the activity row is inserted ~2s after
//     a status change, so activity is re-invalidated on a delay)
//   - which folder caches (lists / counts / last-visit-count) go stale when an
//     item moves between folders
//   - the reply-poll predicate (poll while a reply publish is pending)
//
// Lives in components/inbox/ (not shared/queries/) because the write-through
// reply type comes from the inbox context — shared must not import a context.

import type { QueryClient } from '@tanstack/react-query'
import { inboxKeys } from '#/shared/queries/query-keys'
import type {
  FeedbackHandlingCommandResult,
  InboxItem,
  InboxItemDetailResult,
} from '#/contexts/inbox/application/public-api'

export type InboxReplyCacheChange = Readonly<{
  kind: 'draft_saved' | 'state_changed'
  reply: InboxItemDetailResult['reply']
}>

/** BullMQ inserts the activity row ~2s after a status change — re-invalidate on a lag. */
export const BULLMQ_ACTIVITY_LAG_MS = 2500

/** Poll interval while a reply publish is pending (approved → published, async via BullMQ). */
export const REPLY_POLL_INTERVAL_MS = 3000

// ── Reply-poll predicate ────────────────────────────────────────
//
//   reply status   → interval
//   approved       → REPLY_POLL_INTERVAL_MS (publish pending)
//   anything else  → false (stop polling)
//   no reply       → false

export function replyRefetchInterval(
  reply: Readonly<{ status: string }> | null | undefined,
): number | false {
  return reply && reply.status === 'approved' ? REPLY_POLL_INTERVAL_MS : false
}

// ── Folder caches ───────────────────────────────────────────────
// A status change moves the item between folders → sibling list caches,
// folder-count badges, and the global new-count badge are all stale.

function invalidateFolderCaches(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: inboxKeys.lists() })
  qc.invalidateQueries({ queryKey: inboxKeys.counts() })
  qc.invalidateQueries({ queryKey: inboxKeys.lastVisitCount() })
}

/** Re-invalidate the activity query after the BullMQ insert lag. */
function invalidateActivityAfterLag(qc: QueryClient, id: string): void {
  setTimeout(
    () => qc.invalidateQueries({ queryKey: inboxKeys.activity(id) }),
    BULLMQ_ACTIVITY_LAG_MS,
  )
}

function patchReply(
  qc: QueryClient,
  id: string,
  reply: InboxItemDetailResult['reply'],
): void {
  qc.setQueryData<InboxItemDetailResult>(inboxKeys.detail(id), (old) =>
    old ? { ...old, reply } : old,
  )
}

function patchItem(qc: QueryClient, item: InboxItem): void {
  qc.setQueryData<InboxItemDetailResult>(inboxKeys.detail(item.id), (old) =>
    old ? { ...old, item } : old,
  )
}

// ── The policy ──────────────────────────────────────────────────

export const inboxCachePolicy = {
  /** The server confirmed a successful Inbox visit watermark. */
  async onInboxVisited(qc: QueryClient): Promise<void> {
    await qc.invalidateQueries({ queryKey: inboxKeys.lastVisitCount() })
  },

  /**
   * A bulk reopen completed, including a partial result. The response does not
   * carry authoritative item snapshots, so every Inbox folder projection that
   * can have moved is refreshed together.
   */
  onBulkReopened(qc: QueryClient): void {
    invalidateFolderCaches(qc)
  },

  /** A status command returned the authoritative Inbox item snapshot. */
  onItemStatusChanged(qc: QueryClient, item: InboxItem): void {
    patchItem(qc, item)
    invalidateActivityAfterLag(qc, item.id)
    invalidateFolderCaches(qc)
  },

  /**
   * A private-feedback handling command carries both authoritative surfaces.
   * Initial completion moves folders; a correction only advances the command
   * fence and append-only outcome history.
   */
  onFeedbackHandlingChanged(
    qc: QueryClient,
    result: FeedbackHandlingCommandResult,
    statusChanged: boolean,
  ): void {
    qc.setQueryData<InboxItemDetailResult>(inboxKeys.detail(result.item.id), (old) =>
      old
        ? {
            ...old,
            item: result.item,
            feedbackHandling: result.feedbackHandling,
          }
        : old,
    )
    if (!statusChanged) return
    invalidateActivityAfterLag(qc, result.item.id)
    invalidateFolderCaches(qc)
  },

  /**
   * A reply command returned the authoritative reply snapshot. Draft autosaves
   * and workflow transitions are classified separately by callers, but both
   * affect only this item's reply. Provider-confirmed publication is observed
   * by detail polling; only the resulting Inbox status transition moves folders.
   */
  onReplyChanged(qc: QueryClient, id: string, change: InboxReplyCacheChange): void {
    patchReply(qc, id, change.reply)
  },

  /**
   * A note was added. The note command advances the Inbox command revision in
   * the same transaction, so carry that authoritative fence forward before a
   * manager can issue another command from the still-open detail view.
   */
  onNoteAdded(qc: QueryClient, id: string, resultingCommandRevision: number): void {
    qc.setQueryData<InboxItemDetailResult>(inboxKeys.detail(id), (old) =>
      old
        ? {
            ...old,
            item: {
              ...old.item,
              commandRevision: Math.max(
                old.item.commandRevision,
                resultingCommandRevision,
              ),
            },
          }
        : old,
    )
    qc.invalidateQueries({ queryKey: inboxKeys.notes(id) })
    invalidateActivityAfterLag(qc, id)
  },

  /**
   * The item's status changed server-side (detected while polling — e.g. a
   * published reply auto-closed the item). Only the folder caches are stale.
   */
  onItemFolderChanged(qc: QueryClient): void {
    invalidateFolderCaches(qc)
  },
} as const

export type InboxCachePolicy = typeof inboxCachePolicy
