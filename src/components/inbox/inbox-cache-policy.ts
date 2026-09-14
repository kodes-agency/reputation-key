// InboxCachePolicy — deep module owning the inbox cache-invalidation policy.
//
// The inbox hooks/pages no longer know:
//   - the query-key prefix topology (detail(id) ⊃ notes(id)/activity(id)/history(id))
//   - the BullMQ activity-lag constant (the activity row is inserted ~2s after
//     a status change, so activity is re-invalidated on a delay) versus
//     Handling History, which commits in the command's own transaction and so
//     is invalidated immediately
//   - which folder caches (lists / counts / last-visit-count) go stale when an
//     item moves between folders
//   - the reply-poll predicate (poll while a reply publish is pending; while
//     automatic Google checks still own an uncertain publish, the detail polls
//     each minute and the list reads at the next automatic check's due time)
//   - where a reply command's result belongs: the cached item of the review
//     the command named, not whichever item is open when it settles
//
// Lives in components/inbox/ (not shared/queries/) because the write-through
// reply type comes from the inbox context — shared must not import a context.

import type { QueryClient } from '@tanstack/react-query'
import { inboxKeys } from '#/shared/queries/query-keys'
import { isUncertainReplyStillChecked } from '#/shared/domain/reply-queue-stage'
import type {
  FeedbackHandlingCommandResult,
  InboxItem,
  InboxItemDetailResult,
} from '#/contexts/inbox/application/public-api'

export type InboxReplyCacheChange = Readonly<{
  kind: 'draft_saved' | 'state_changed'
  reply: InboxItemDetailResult['reply']
  /**
   * The review the command was issued for, read from the command's own input.
   * Never the pane's current item: the pane builds one reply command family
   * and is not remounted per item, so a pending mutation settles through the
   * options of whatever item is open by then (query-core mutationObserver.ts
   * `setOptions` hands a pending mutation the new options).
   */
  reviewId: string
}>

/** BullMQ inserts the activity row ~2s after a status change — re-invalidate on a lag. */
export const BULLMQ_ACTIVITY_LAG_MS = 2500

/** Poll cadence while a detail reply still has a bounded background owner. */
export const REPLY_POLL_INTERVAL_MS = 3000

/**
 * The paged, enriched list is five times heavier than a detail read. A 15s
 * cadence keeps manager-visible progress current without issuing it every 3s.
 */
export const INBOX_LIST_REPLY_POLL_INTERVAL_MS = 15_000

/**
 * D8: cadence while an uncertain publish (publish_failed + ambiguous) still has
 * a reconcile_due_at. The server reads Google on a ladder of 15 minutes to 72
 * hours (`AMBIGUOUS_RECONCILE_LADDER_MS`), so a one-minute read is ample and
 * cheap; the in-flight age ceiling does not apply because the due time itself
 * says a background owner remains, and each read refreshes that evidence.
 */
export const UNCERTAIN_REPLY_POLL_INTERVAL_MS = 60_000

/**
 * How long past its due time a still-checked row keeps the LIST polling: two
 * runs of the sweep that advances it (`reconcile-ambiguous-publications`,
 * `schedule: 'every:300000'` in event-job-catalogue.ts). A row still unmoved
 * after that has a stalled sweep, which no browser read can advance.
 */
export const UNCERTAIN_REPLY_LIST_DUE_SLACK_MS = 10 * 60_000

/**
 * Browser-side ceiling for in-flight polling. An approved publication leaves
 * the in-flight states within about 25 minutes: the 15-minute propagation grace
 * for an uncertain send or an accepted write
 * (`UNCERTAIN_SEND_PROPAGATION_GRACE_MS`, `PROVIDER_OBSERVATION_PROPAGATION_GRACE_MS`)
 * or the 20-minute recovery delay, plus the five-minute sweep. After that it is
 * published, not published, or an uncertain publish with its own slower cadence.
 */
export const REPLY_POLL_MAX_AGE_MS = 30 * 60 * 1000

export const POLLED_PUBLICATION_STATES: Readonly<Record<string, true>> = {
  requested: true,
  authorized: true,
  sending: true,
  pending_observation: true,
}

type ReplyPollingCandidate = Readonly<{
  status: string
  publicationState?: string | null
  /** Absent on a Google-observed reply, which nothing polls. */
  reconcileDueAt?: Date | string | null
  updatedAt: Date | string
}>

function isReplyStillCheckedAutomatically(reply: ReplyPollingCandidate): boolean {
  return isUncertainReplyStillChecked({
    ...reply,
    publicationState: reply.publicationState ?? null,
  })
}

/** Active publication ownership, without applying the browser age ceiling. */
export function isReplyPublicationInFlight(
  reply: ReplyPollingCandidate | null | undefined,
): boolean {
  return (
    reply?.status === 'approved' &&
    !!reply.publicationState &&
    Object.hasOwn(POLLED_PUBLICATION_STATES, reply.publicationState)
  )
}

/**
 * Any background owner still advancing the reply, in flight or on the
 * automatic read ladder, without the browser age ceiling. List settlement
 * detection uses it: a row leaving this set may have changed queues.
 */
export function isReplyPolled(reply: ReplyPollingCandidate | null | undefined): boolean {
  return (
    !!reply &&
    (isReplyPublicationInFlight(reply) || isReplyStillCheckedAutomatically(reply))
  )
}

function timeMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value)
}

function isReplyWithinPollingAge(reply: ReplyPollingCandidate, nowMs: number): boolean {
  const updatedAtMs = timeMs(reply.updatedAt)
  return Number.isFinite(updatedAtMs) && nowMs - updatedAtMs < REPLY_POLL_MAX_AGE_MS
}

// Poll only while a registered background component can still advance the
// publication. The worker/reconciler deadline is 25 minutes; the browser stops
// in-flight polling after 30 minutes even if a stale cache snapshot never
// observes settlement. An uncertain publish still on the automatic read ladder
// polls every minute; terminal ambiguity and every other state do not poll.
export function replyRefetchInterval(
  reply: ReplyPollingCandidate | null | undefined,
  nowMs = Date.now(),
): number | false {
  if (!reply) return false
  if (isReplyPublicationInFlight(reply)) {
    return isReplyWithinPollingAge(reply, nowMs) ? REPLY_POLL_INTERVAL_MS : false
  }
  return isReplyStillCheckedAutomatically(reply)
    ? UNCERTAIN_REPLY_POLL_INTERVAL_MS
    : false
}

/**
 * A still-checked row changes only when the sweep reads it at its due time, so
 * the list reads then rather than every minute: a list read re-reads every
 * loaded page, and a 72-hour ladder at one read a minute is ~4,300 of them. At
 * or past the due time it reads each minute while the sweep takes the row, and
 * stops once the row is `UNCERTAIN_REPLY_LIST_DUE_SLACK_MS` overdue. The open
 * detail pane keeps D8's one-minute cadence (`replyRefetchInterval`): it is
 * one cheap read, and it is where a manager watches the reply.
 */
function listRowRefetchInterval(
  reply: ReplyPollingCandidate | null | undefined,
  nowMs: number,
): number | false {
  if (!reply) return false
  if (isReplyPublicationInFlight(reply)) {
    return isReplyWithinPollingAge(reply, nowMs)
      ? INBOX_LIST_REPLY_POLL_INTERVAL_MS
      : false
  }
  if (!isReplyStillCheckedAutomatically(reply) || !reply.reconcileDueAt) return false
  const untilDueMs = timeMs(reply.reconcileDueAt) - nowMs
  if (!Number.isFinite(untilDueMs) || untilDueMs < -UNCERTAIN_REPLY_LIST_DUE_SLACK_MS) {
    return false
  }
  return Math.max(UNCERTAIN_REPLY_POLL_INTERVAL_MS, untilDueMs)
}

/** Poll the loaded rows at the fastest cadence any one of them needs. */
export function inboxListReplyRefetchInterval(
  items: ReadonlyArray<Pick<InboxItem, 'replyState'>> | null | undefined,
  nowMs = Date.now(),
): number | false {
  let interval: number | false = false
  for (const { replyState } of items ?? []) {
    const rowInterval = listRowRefetchInterval(replyState, nowMs)
    if (rowInterval !== false && (interval === false || rowInterval < interval)) {
      interval = rowInterval
    }
  }
  return interval
}

/**
 * Every loaded page at once. Taking the first page that polls let a slow
 * still-checked row on page 1 set the cadence for an in-flight row on page 2.
 */
export function inboxListPagesRefetchInterval(
  pages:
    | ReadonlyArray<Readonly<{ items: ReadonlyArray<Pick<InboxItem, 'replyState'>> }>>
    | undefined,
  nowMs = Date.now(),
): number | false {
  return inboxListReplyRefetchInterval(
    (pages ?? []).flatMap((page) => page.items),
    nowMs,
  )
}

/** What a polled detail read said about its reply, for change detection. */
export type ReplyPublicationObservation = Readonly<{
  itemId: string
  status: string | null
  publicationState: string | null
  isPolled: boolean
}>

export function observeReplyPublication(
  itemId: string,
  reply: ReplyPollingCandidate | null | undefined,
): ReplyPublicationObservation {
  return {
    itemId,
    status: reply?.status ?? null,
    publicationState: reply?.publicationState ?? null,
    isPolled: isReplyPolled(reply),
  }
}

/**
 * True when a background read moved a reply a background owner was advancing
 * (in flight or still checked, `isReplyPolled`): its status or publication
 * state changed on the same item. That can move the item
 * between queues (Waiting for Google ⇄ Needs reply), so lists and counts are
 * stale. First reads, selection changes and replies nothing polls are not
 * transitions; mutation results are recorded before they reach the cache.
 */
export function polledReplyPublicationChanged(
  previous: ReplyPublicationObservation | null,
  current: ReplyPublicationObservation,
): boolean {
  return (
    previous !== null &&
    previous.isPolled &&
    previous.itemId === current.itemId &&
    (previous.status !== current.status ||
      previous.publicationState !== current.publicationState)
  )
}

// ── Folder caches ───────────────────────────────────────────────
// A status change moves the item between folders → sibling list caches,
// folder-count badges, and the global new-count badge are all stale.

function invalidateFolderCaches(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: inboxKeys.lists() })
  qc.invalidateQueries({ queryKey: inboxKeys.counts() })
  qc.invalidateQueries({ queryKey: inboxKeys.lastVisitCount() })
}

function invalidateFolderSummaryCaches(qc: QueryClient): void {
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

/**
 * The Handling History row is written in the SAME transaction as the command
 * that caused it, so by the time a command's `onSuccess` runs the new event is
 * already readable — no lag, unlike the activity feed. The detail thread reads
 * `history(id)` and nothing else refreshes it: `detail(id)` is only ever
 * write-through patched here, never invalidated, so the prefix does not carry
 * the refresh for us.
 */
function invalidateHistory(qc: QueryClient, id: string): void {
  qc.invalidateQueries({ queryKey: inboxKeys.history(id) })
}

/** `detail(id)` itself, not the notes/activity/history entries nested under it. */
const DETAIL_KEY_LENGTH = inboxKeys.detail('').length

/**
 * The ids of the cached items whose review is `reviewId`. A reply belongs to a
 * review, so this is where a reply command's result goes — found by the
 * detail's own `item.sourceId`, the same field the pane reads the command's
 * `reviewId` from (inbox-detail-content.tsx `useReplyActions`).
 */
function cachedItemIdsForReview(qc: QueryClient, reviewId: string): string[] {
  return qc
    .getQueriesData<InboxItemDetailResult>({
      queryKey: inboxKeys.details(),
      predicate: (query) => query.queryKey.length === DETAIL_KEY_LENGTH,
    })
    .filter(([, detail]) => detail?.item.sourceId === reviewId)
    .map(([key]) => String(key[DETAIL_KEY_LENGTH - 1]))
}

function patchReply(qc: QueryClient, change: InboxReplyCacheChange): void {
  for (const itemId of cachedItemIdsForReview(qc, change.reviewId)) {
    qc.setQueryData<InboxItemDetailResult>(inboxKeys.detail(itemId), (old) =>
      old ? { ...old, reply: change.reply } : old,
    )
  }
}
/**
 * Command snapshots deliberately omit list/detail enrichments. They are
 * authoritative for every other field, including explicit nulls.
 */
export function mergeInboxCommandItem(cached: InboxItem, command: InboxItem): InboxItem {
  return {
    ...cached,
    ...command,
    rating: cached.rating,
    snippet: cached.snippet,
    reviewerName: cached.reviewerName,
    propertyName: cached.propertyName,
    contentAvailability: cached.contentAvailability,
    reviewLanguageCode: cached.reviewLanguageCode,
    attention: cached.attention,
  }
}

function patchItem(qc: QueryClient, item: InboxItem): void {
  qc.setQueryData<InboxItemDetailResult>(inboxKeys.detail(item.id), (old) =>
    old ? { ...old, item: mergeInboxCommandItem(old.item, item) } : old,
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

  /**
   * A status command returned the authoritative Inbox item snapshot. Close,
   * reopen, assign, escalate and resolve-escalation all land here, and every
   * one of them appends a Handling History row, so the detail thread is stale
   * the moment this resolves.
   */
  onItemStatusChanged(qc: QueryClient, item: InboxItem): void {
    patchItem(qc, item)
    invalidateHistory(qc, item.id)
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
            item: mergeInboxCommandItem(old.item, result.item),
            feedbackHandling: result.feedbackHandling,
          }
        : old,
    )
    // A correction writes a new append-only outcome revision without moving
    // folders, so history goes stale on BOTH branches — before the early
    // return, not after it.
    invalidateHistory(qc, result.item.id)
    if (!statusChanged) return
    invalidateActivityAfterLag(qc, result.item.id)
    invalidateFolderCaches(qc)
  },

  /**
   * A reply command returned the authoritative detail snapshot. Draft
   * autosaves remain detail-only; every workflow transition refreshes governed
   * list state so approval chips and publication polling start immediately.
   */
  onReplyChanged(qc: QueryClient, change: InboxReplyCacheChange): void {
    patchReply(qc, change)
    if (change.kind === 'state_changed') {
      qc.invalidateQueries({ queryKey: inboxKeys.lists() })
      qc.invalidateQueries({ queryKey: inboxKeys.counts() })
    }
  },

  /**
   * Whether a reply command's result is about the item `id` — the one the
   * pane has open when the command settles. False when the manager moved to
   * another item while it was in flight, so nothing about that result may be
   * recorded or said as if it were this item's.
   */
  isReplyChangeForItem(qc: QueryClient, id: string, change: InboxReplyCacheChange) {
    const detail = qc.getQueryData<InboxItemDetailResult>(inboxKeys.detail(id))
    return detail?.item.sourceId === change.reviewId
  },

  /**
   * "Check Google again" was refused or failed. The usual cause of a refusal is
   * a pane that is behind: another manager or tab already moved the reply out
   * of every checkable state (`check-reply-publication.ts` NOTHING_TO_CHECK),
   * and nothing polls a reply that needs a check (`replyRefetchInterval`). So
   * the review's detail, the lists and the counts are re-read, and the pane
   * shows the reply as it is next to the toast.
   */
  onReplyCheckFailed(qc: QueryClient, reviewId: string): void {
    for (const itemId of cachedItemIdsForReview(qc, reviewId)) {
      qc.invalidateQueries({ queryKey: inboxKeys.detail(itemId), exact: true })
    }
    qc.invalidateQueries({ queryKey: inboxKeys.lists() })
    qc.invalidateQueries({ queryKey: inboxKeys.counts() })
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
   * A detail poll saw its reply change status or publication state (D8). The
   * item may have moved queues, so the lists and queue counts are stale; the
   * detail query already holds the new read and is not invalidated.
   */
  onPolledReplyChanged(qc: QueryClient): void {
    qc.invalidateQueries({ queryKey: inboxKeys.lists() })
    qc.invalidateQueries({ queryKey: inboxKeys.counts() })
  },

  /**
   * A reply observed by list polling settled or left the loaded folder.
   * The list query already owns that refetch; invalidating it here would loop.
   */
  onListReplySettled(qc: QueryClient): void {
    invalidateFolderSummaryCaches(qc)
  },

  /**
   * The item's status changed server-side (detected while polling — e.g. a
   * published reply auto-closed the item). The server wrote that transition's
   * Handling History row in the same transaction as the status flip, so the
   * thread is stale too — and polling stops the moment the reply settles, so
   * nothing later would refetch it.
   */
  onItemFolderChanged(qc: QueryClient, id: string): void {
    invalidateHistory(qc, id)
    invalidateFolderCaches(qc)
  },
} as const

export type InboxCachePolicy = typeof inboxCachePolicy
