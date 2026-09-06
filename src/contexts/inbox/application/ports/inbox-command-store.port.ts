// Inbox command store — atomic inbox state mutation + outbox record (BQC-3.4).
//
// Callers must not know Drizzle transaction types or outbox tables.
// The production implementation commits the state write, outbox facts, and
// consumer receipts in one PostgreSQL transaction. Durable consumers receive
// those facts through the outbox relay.

import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import type {
  HandlingCycleActorType,
  HandlingCycleCloseReason,
  InboxItem,
  InboxNote,
  InboxStatus,
} from '../../domain/types'
import type { ManualReopenReason } from '../../domain/types'
import type {
  HandlingCycleExpectation,
  ReviewHandlingCycleExpectation,
} from './review-handling-cycle.store'
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
import type { CurrentReplyObservationPermit } from './reply-observation-authority.port'
import type {
  CurrentReviewInboxProjectionPermit,
  ReviewCycleTargetAnchor,
} from './review-response-target-authority.port'

/** Status mutation + the timestamp fields derived for the target status. */
export type InboxStatusUpdate = Readonly<{
  status: InboxStatus
  timestampFields: Partial<Record<string, Date | null>>
}>

/** Receipt statuses — mirror the outbox consumer receipt contract. */
export type ApplyReceiptStatus = 'applied' | 'duplicate' | 'obsolete'

export type CreateItemResult = Readonly<{ item: InboxItem; created: boolean }>

/** Canonical immutable source occurrence that opens cycle one. */
export type HandlingCycleCreationAnchor = Readonly<{
  sourceRevision: number
  openedReason: 'legacy_backfill' | 'review_observed' | 'feedback_submitted'
  actorType: HandlingCycleActorType
  triggerEventId: string | null
  openedAt: Date
  /** Null explicitly suppresses a target for a source that is not active. */
  responseTarget?: ReviewCycleTargetAnchor | null
}>

/** Compatibility input for existing Review repair callers. */
export type ReviewCycleCreationAnchor = Readonly<{
  materialReviewRevision: number
}>

export type BulkStatusStoreItemResult = Readonly<{
  inboxItemId: InboxItemId
  outcome: 'reopened' | 'revision_conflict'
}>

export type BulkStatusStoreResult = Readonly<{
  updated: number
  results: ReadonlyArray<BulkStatusStoreItemResult>
}>

export type BulkAssignmentStoreItemResult = Readonly<{
  inboxItemId: InboxItemId
  outcome: 'assigned' | 'reassigned' | 'released' | 'unchanged' | 'revision_conflict'
}>

export type BulkAssignmentStoreResult = Readonly<{
  updated: number
  results: ReadonlyArray<BulkAssignmentStoreItemResult>
}>

export type BulkAssignmentCommand = Readonly<{
  items: ReadonlyArray<InboxItem>
  assignedTo: UserId | null
  actorId: UserId
  bulkId: string
  occurredAt: Date
}>

export type BulkReopenGovernance = Readonly<{
  reason: ManualReopenReason
  explanation: string | null
}>

export type ReopenReviewHandlingCycleCommand = Readonly<{
  item: InboxItem
  expected: HandlingCycleExpectation | ReviewHandlingCycleExpectation
  reason: ManualReopenReason
  explanation: string | null
  fact: InboxItemStatusChanged
  now: Date
  responseTarget?: ReviewCycleTargetAnchor
}>

/**
 * Source-created projection command: idempotent item create + created fact
 * (only when the insert wins) + receipt — one transaction. Shared by review
 * and Guest feedback sources so the atomicity rule has one implementation.
 */
export type ApplySourceCreatedCommand = Readonly<{
  /** The delivered source event id (receipt identity). */
  eventId: string
  consumerName: string
  item: InboxItem
  fact: InboxItemCreated
  cycleAnchor?: HandlingCycleCreationAnchor
}>

/** Source withdrawal: guarded close + status fact + consumer receipt. */
export type ApplySourceWithdrawnCommand = Readonly<{
  eventId: string
  consumerName: string
  item: InboxItem
  sourceRevision?: number
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
  materialReviewRevision?: number | null
  responseTarget?: ReviewCycleTargetAnchor
  now: Date
}>

/**
 * Ordered, content-free Review projection convergence command. Review holds
 * its current source fence while this one Inbox transaction creates the
 * stable item, restores every Material Revision cycle, closes inactive work,
 * records facts, and commits the consumer receipt.
 */
export type ApplyReviewProjectionCommand = Readonly<{
  eventId: string
  consumerName: string
  eventKind: 'created' | 'updated'
  item: InboxItem
  fact: InboxItemCreated
  projection: CurrentReviewInboxProjectionPermit
  now: Date
}>

/**
 * REV-01 source transition: preserve the stable Inbox identity while removing
 * every legacy provider-controlled projection value. The store decides under
 * its row lock whether open work also closes and records `closeFact` only when
 * that open -> closed transition actually lands.
 */
export type ApplyReviewSourceTransitionedCommand = Readonly<{
  eventId: string
  consumerName: string
  item: InboxItem
  transitionedAt: Date
  /** Exact-current source transitions close; unversioned legacy expiry only scrubs. */
  closeIfOpen: boolean
  closeReason?: HandlingCycleCloseReason
  closeFact: InboxItemStatusChanged
}>

/** Legacy review.reply.published compatibility envelope. The apply method is
 * receipt-only; these former mutation fields are ignored so older delivery
 * shapes cannot regain Inbox closure authority. */
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

export type ApplyReplyObservedCommand = Readonly<{
  eventId: string
  consumerName: string
  item: InboxItem
  /** Issued only while Review holds the exact current-head fence. */
  currentObservation: CurrentReplyObservationPermit
  closeFact: InboxItemStatusChanged
  reopenFact: InboxItemStatusChanged
}>

export type InboxCommandStore = Readonly<{
  /**
   * Offboarding release: clear every assignment owned by one departing user
   * and record one unassigned fact per item in the same transaction.
   */
  releaseAssignmentsForUser(
    input: Readonly<{
      organizationId: OrganizationId
      userId: UserId
      /** Null for provider lifecycle hooks that do not expose the initiating actor. */
      actorId: UserId | null
      at: Date
    }>,
  ): Promise<Readonly<{ released: number }>>

  /**
   * Eligibility reconciliation: re-check every currently assigned Property
   * against the exact assignee authority inside the write transaction, then
   * clear only assignments whose authority is definitively no longer current.
   * The operation is idempotent and writes one durable unassigned fact and
   * append-only history row for every assignment it clears.
   */
  releaseIneligibleAssignmentsForUser(
    input: Readonly<{
      organizationId: OrganizationId
      userId: UserId
      actorId: UserId
      at: Date
    }>,
  ): Promise<Readonly<{ released: number }>>

  /**
   * Insert the item + inbox.inbox_item.created fact in one transaction.
   * Idempotent on the (sourceType, sourceId, organizationId) unique anchor:
   * a conflicting concurrent insert returns the existing row with
   * `created: false` and records NO fact. `event` is null only for repair
   * paths (rebuild) — creation-during-repair is not new information, so no
   * fact is recorded.
   */
  createItem(
    item: InboxItem,
    event: InboxItemCreated | null,
    cycleAnchor?: HandlingCycleCreationAnchor | ReviewCycleCreationAnchor,
  ): Promise<CreateItemResult>

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
   * Append a governed manual-reopen cycle and advance its canonical head while
   * synchronizing the legacy item projection and status fact in one
   * head-before-item transaction. A still-assigned manager is retained only
   * while their source-specific Property authority remains current.
   */
  reopenReviewCycle(command: ReopenReviewHandlingCycleCommand): Promise<InboxItem>

  /**
   * One transaction preauthorizes the complete reopen set, applies one CAS per
   * item, and writes a bulk_status_changed fact only for each landed CAS.
   * Per-item results preserve input order at the use-case boundary; landed
   * facts are recorded in the command transaction. Bulk Close is rejected.
   */
  bulkUpdateStatus(
    items: ReadonlyArray<InboxItem>,
    perItemEvents: ReadonlyArray<InboxItemBulkStatusChanged>,
    governance: BulkReopenGovernance,
    reviewResponseTargets?: ReadonlyMap<string, ReviewCycleTargetAnchor>,
  ): Promise<BulkStatusStoreResult>

  /**
   * All-or-nothing bounded assignment command. The store locks every Review
   * head and Inbox row in canonical order, revalidates actor + assignee
   * authority for the complete set, then commits every row/history/per-item
   * fact and one content-free completion fact in one transaction.
   */
  bulkAssign(command: BulkAssignmentCommand): Promise<BulkAssignmentStoreResult>

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
  addNote(item: InboxItem, note: InboxNote, event: InboxNoteAdded): Promise<InboxNote>

  // ── Projection applyOnce (durable consumers) ──────────────────────
  // Each co-commits the projection state change, any outbox fact, and the
  // consumer receipt in ONE transaction — a crash can never lose a fact or
  // duplicate a side effect across redelivery.

  /** Source event: idempotent create + created fact + receipt. */
  applySourceCreatedOnce(
    command: ApplySourceCreatedCommand,
  ): Promise<'applied' | 'duplicate'>
  applyReviewProjectionOnce(
    command: ApplyReviewProjectionCommand,
  ): Promise<'applied' | 'duplicate'>
  /** Guest feedback withdrawal: close its metadata-only work item. */
  applySourceWithdrawnOnce(
    command: ApplySourceWithdrawnCommand,
  ): Promise<'applied' | 'obsolete'>
  /** review.updated: metadata-only sourceDate/platform refresh + receipt. */
  applyReviewUpdatedOnce(command: ApplyReviewUpdatedCommand): Promise<'applied'>
  /** Review source transition: scrub legacy content, close open work, and receipt. */
  applyReviewSourceTransitionedOnce(
    command: ApplyReviewSourceTransitionedCommand,
  ): Promise<'applied'>
  /** review.reply.published compatibility receipt; never mutates Inbox state. */
  applyReplyPublishedOnce(command: ApplyReplyPublishedCommand): Promise<'applied'>
  /**
   * Apply a Review-issued exact-current permit: atomically close or reopen the
   * current Handling Cycle, record the status fact, and commit the receipt.
   */
  applyReplyObservedOnce(
    command: ApplyReplyObservedCommand,
  ): Promise<'applied' | 'obsolete'>
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
