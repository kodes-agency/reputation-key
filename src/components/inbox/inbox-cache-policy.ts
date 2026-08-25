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
import type { InboxItemDetailResult } from '#/contexts/inbox/application/public-api'

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

// ── The policy ──────────────────────────────────────────────────

export const inboxCachePolicy = {
  /** The server confirmed a successful Inbox visit watermark. */
  async onInboxVisited(qc: QueryClient): Promise<void> {
    await qc.invalidateQueries({ queryKey: inboxKeys.lastVisitCount() })
  },

  /**
   * A status mutation succeeded (mark-read / escalate / archive / resolve).
   * detail(id) is a PREFIX of notes + activity → one invalidate refreshes all
   * three; the BullMQ-inserted activity row is caught by the delayed
   * re-invalidate. Targeted — never router.invalidate().
   */
  onStatusChanged(qc: QueryClient, id: string): void {
    qc.invalidateQueries({ queryKey: inboxKeys.detail(id) })
    invalidateActivityAfterLag(qc, id)
    invalidateFolderCaches(qc)
  },

  /**
   * A reply mutation (submit/approve/reject/publish) succeeded. Writes the new
   * reply straight into the detail cache so revisiting the item shows it
   * without a refetch. Publishing also auto-closes the inbox item server-side
   * (on-reply-published event handler), so the folder caches are stale too.
   */
  onReplyMutated(
    qc: QueryClient,
    id: string,
    reply: InboxItemDetailResult['reply'],
  ): void {
    qc.setQueryData<InboxItemDetailResult>(inboxKeys.detail(id), (old) =>
      old ? { ...old, reply } : old,
    )
    qc.invalidateQueries({ queryKey: inboxKeys.detail(id) })
    invalidateFolderCaches(qc)
  },

  /** A note was added — refresh notes now, activity after the BullMQ lag. */
  onNoteAdded(qc: QueryClient, id: string): void {
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
