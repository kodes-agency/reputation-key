// Inbox command store — atomic inbox state mutation + outbox record (BQC-3.4).
//
// Callers must not know Drizzle transaction types or outbox tables.
// The production implementation commits the state write, the outbox_events
// rows (emitted facts), and consumer receipts in one PostgreSQL transaction,
// then emits on the in-process bus after commit (expand-phase dual path
// until the durable switch).

import type { UserId } from '#/shared/domain/ids'
import type { InboxItem, InboxNote, InboxStatus } from '../../domain/types'
import type {
  InboxItemAssigned,
  InboxItemBulkStatusChanged,
  InboxItemCreated,
  InboxItemEscalated,
  InboxItemEscalationResolved,
  InboxItemStatusChanged,
  InboxItemUnassigned,
  InboxNoteAdded,
} from '../../domain/events'

/** Status mutation + the timestamp fields derived for the target status. */
export type InboxStatusUpdate = Readonly<{
  status: InboxStatus
  timestampFields: Partial<Record<string, Date>>
}>

/** Receipt statuses — mirror the outbox consumer receipt contract. */
export type ApplyReceiptStatus = 'applied' | 'duplicate' | 'obsolete'

export type CreateItemResult = Readonly<{ item: InboxItem; created: boolean }>

/**
 * review.created apply command: idempotent item create + created fact (only
 * when the insert wins) + receipt — one transaction.
 */
export type ApplyReviewCreatedCommand = Readonly<{
  /** The delivered review.created outbox event id (receipt identity). */
  eventId: string
  consumerName: string
  item: InboxItem
  fact: InboxItemCreated
}>

/**
 * review.expired apply command: guarded close (skips when the item's status
 * moved concurrently) + status_changed fact (only when the close landed) +
 * receipt — one transaction.
 */
export type ApplyReviewExpiredCommand = Readonly<{
  eventId: string
  consumerName: string
  item: InboxItem
  now: Date
  fact: InboxItemStatusChanged
}>

/**
 * review.updated apply command: metadata-only refresh of the projection's
 * sourceDate/platform + receipt — one transaction. No fact: a metadata
 * refresh is not new inbox information.
 */
export type ApplyReviewUpdatedCommand = Readonly<{
  eventId: string
  consumerName: string
  item: InboxItem
  sourceDate: Date
  platform: string | null
  now: Date
}>

/**
 * review.reply.published apply command: firstReplyPublishedAt milestone
 * stamping + guarded auto-close + status_changed fact (only when the close
 * landed) + receipt — one transaction.
 */
export type ApplyReplyPublishedCommand = Readonly<{
  eventId: string
  consumerName: string
  item: InboxItem
  occurredAt: Date
  /** True when open → closed is a valid transition for the read item. */
  closeItem: boolean
  /** True when firstReplyPublishedAt is not yet stamped. */
  stampMilestone: boolean
  /** status_changed fact — present only when the close actually transitions. */
  fact: InboxItemStatusChanged | null
}>

export type InboxCommandStore = Readonly<{
  /**
   * Insert the item + inbox.inbox_item.created fact in one transaction.
   * Idempotent on the (sourceType, sourceId, organizationId) unique anchor:
   * a conflicting concurrent insert returns the existing row with
   * `created: false` and records NO fact. `event` is null only for repair
   * paths (rebuild) — creation-during-repair is not new information, so no
   * fact is recorded or emitted.
   */
  createItem(item: InboxItem, event: InboxItemCreated | null): Promise<CreateItemResult>

  /**
   * Status transition + inbox.inbox_item.status_changed fact in one
   * transaction. Throws not_found when the row vanished — the same contract
   * as InboxRepository.updateStatus. `event` is null for fact-less
   * projection writes (milestone stamping during rebuild).
   */
  updateStatus(
    item: InboxItem,
    updates: InboxStatusUpdate,
    event: InboxItemStatusChanged | null,
    now?: Date,
  ): Promise<InboxItem>

  /**
   * ONE bulk update statement + N per-item bulk_status_changed outbox rows
   * in one transaction (kills the partial-fan-out window), then N
   * post-commit emits. Target status/timestamps derive from the events —
   * they share newStatus + occurredAt by construction.
   */
  bulkUpdateStatus(
    items: ReadonlyArray<InboxItem>,
    perItemEvents: ReadonlyArray<InboxItemBulkStatusChanged>,
  ): Promise<{ updated: number }>

  /**
   * Assignment update + assigned/unassigned fact in one transaction
   * (assignedTo null covers the unassign path). `event` is null when
   * unassigning an item that had no assignee (no fact, mirrors the use
   * case's pre-BQC-3.4 behavior).
   */
  assign(
    item: InboxItem,
    updates: Readonly<{ assignedTo: UserId | null }>,
    event: InboxItemAssigned | InboxItemUnassigned | null,
    now?: Date,
  ): Promise<InboxItem>

  /** Set the escalation flag + escalated fact in one transaction. */
  escalate(
    item: InboxItem,
    updates: Readonly<{ escalatedBy: UserId }>,
    event: InboxItemEscalated,
    now?: Date,
  ): Promise<InboxItem>

  /** Clear the escalation flag + escalation_resolved fact in one transaction. */
  resolveEscalation(
    item: InboxItem,
    updates: Readonly<{ resolvedBy: UserId }>,
    event: InboxItemEscalationResolved,
    now?: Date,
  ): Promise<InboxItem>

  /** Note insert + inbox.inbox_note.added fact (note ID, never text) in one transaction. */
  addNote(note: InboxNote, event: InboxNoteAdded): Promise<InboxNote>

  // ── Projection applyOnce (durable consumers) ──────────────────────
  // Each co-commits the projection state change, any emitted fact, and the
  // consumer receipt in ONE transaction — a crash can never lose a fact or
  // duplicate a side effect across redelivery.

  /** review.created: idempotent create + created fact + receipt. */
  applyReviewCreatedOnce(
    command: ApplyReviewCreatedCommand,
  ): Promise<'applied' | 'duplicate'>
  /** review.expired: guarded close + status_changed fact + receipt. */
  applyReviewExpiredOnce(command: ApplyReviewExpiredCommand): Promise<'applied'>
  /** review.updated: metadata-only sourceDate/platform refresh + receipt. */
  applyReviewUpdatedOnce(command: ApplyReviewUpdatedCommand): Promise<'applied'>
  /** review.reply.published: milestone stamp + guarded close + fact + receipt. */
  applyReplyPublishedOnce(command: ApplyReplyPublishedCommand): Promise<'applied'>
  /**
   * Receipt-only write for apply paths with no state change (obsolete
   * source, missing item no-ops). Idempotent via the (eventId, consumerName)
   * primary key.
   */
  recordReceipt(
    eventId: string,
    consumerName: string,
    status: ApplyReceiptStatus,
  ): Promise<void>
}>
