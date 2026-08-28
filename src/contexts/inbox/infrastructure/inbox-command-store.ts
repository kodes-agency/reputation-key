// Atomic inbox command store (BQC-3.4).
//
// One PostgreSQL transaction per command: inbox state mutation + outbox_events
// fact insert (+ consumer receipt for the projection applyOnce paths). After
// commit: in-process EventBus emit for expand-phase legacy consumers.
//
// Crash contract:
// - Crash anywhere inside the transaction rolls back the state mutation, the
//   outbox rows, AND the receipt together — no state/outbox/receipt split is
//   ever observable (the pre-BQC-3.4 consumers could lose the
//   inbox_item.status_changed fact between separate awaits).
// - Crash after commit but before the bus emit leaves a durable outbox row
//   for the relay; the emit is best-effort (failure-isolated, logged).
// - createItem is idempotent on the (sourceType, sourceId, organizationId)
//   unique anchor: a conflicting concurrent insert re-selects the existing
//   row and records NO fact — the projection path and rebuild depend on this.
// - A guarded applyOnce transition that matches no row (lost TOCTOU race)
//   records the receipt but NO fact — redelivery converges, rebuild heals.

import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  inboxAssignmentHistory,
  inboxEscalationHistory,
  inboxHandlingCycleHeads,
  inboxHandlingCycleTransitions,
  inboxHandlingCycles,
  inboxItems,
  inboxNotes,
} from '#/shared/db/schema/inbox.schema'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { emitAfterCommit, insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import {
  inboxItemId,
  feedbackId,
  organizationId,
  propertyId,
  reviewId,
  userId,
  type OrganizationId,
  type UserId,
} from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { Permission } from '#/shared/domain/permissions'
import type {
  HandlingCycleHead,
  HandlingCycleTransition,
  InboxItem,
} from '../domain/types'
import { inboxError } from '../domain/errors'
import {
  inboxBulkAssignmentCompleted,
  inboxHandlingCycleClosed,
  inboxHandlingCycleOpened,
  inboxHandlingCycleReopened,
  inboxItemAssigned,
  inboxItemStatusChanged,
  inboxItemUnassigned,
} from '../domain/events'
import { inboxItemFromRow, inboxItemToInsertRow } from './mappers/inbox.mapper'
import { inboxNoteFromRow, inboxNoteToInsertRow } from './mappers/inbox-note.mapper'
import {
  cycleInsert,
  insertInitialHandlingCycle,
  transitionInsert,
} from './review-handling-cycle.store'
import {
  closeHandlingCycle,
  createNextHandlingCycle,
  type HandlingCycleDecision,
} from '../domain/handling-cycles'
import type {
  ApplyReceiptStatus,
  HandlingCycleCreationAnchor,
  InboxCommandStore,
  ReviewCycleCreationAnchor,
} from '../application/ports/inbox-command-store.port'
import {
  cancelPrivateFeedbackTarget,
  cancelResponseTargetForCycle,
  completeGoogleReviewTarget,
  insertResponseTargetForHandlingCycle,
} from './response-target.store'

export type InboxCommandAuthorityPrincipal = Readonly<{
  userId: string
  permissions: readonly Permission[]
  purpose: 'actor' | 'assignee'
}>

export type InboxCommandAuthorityRequirement = InboxCommandAuthorityPrincipal &
  Readonly<{ propertyId: string }>

export type InboxCommandAuthority = (
  tx: Tx,
  input: Readonly<{
    organizationId: string
    at: Date
    requirements: readonly InboxCommandAuthorityRequirement[]
  }>,
) => Promise<Readonly<{ allowed: true }> | Readonly<{ allowed: false; reason: string }>>

const sourceCommandPermission = (sourceType: InboxItem['sourceType']): Permission =>
  sourceType === 'review' ? 'review.read' : 'feedback.handle'

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const assignmentAuthorityKey = (
  propertyIdValue: string,
  sourceType: (typeof inboxItems.$inferSelect)['sourceType'],
): string => `${propertyIdValue}\u0000${sourceType}`

const webActorId = (event: DomainEvent | null): string | null => {
  if (
    event === null ||
    !('source' in event) ||
    event.source !== 'web' ||
    !('userId' in event) ||
    typeof event.userId !== 'string'
  ) {
    return null
  }
  return event.userId
}

async function insertReceiptRow(
  tx: Tx,
  eventId: string,
  consumerName: string,
  status: ApplyReceiptStatus,
): Promise<void> {
  await tx
    .insert(eventConsumerReceipts)
    .values({ eventId, consumerName, status })
    .onConflictDoNothing()
}

/** Reserve a delivery inside the apply transaction. A concurrent duplicate
 * blocks on the receipt key and then observes no returned row, so it cannot
 * repeat a close/reopen after a later workflow transition. */
async function reserveReceiptRow(
  tx: Tx,
  eventId: string,
  consumerName: string,
): Promise<boolean> {
  const rows = await tx
    .insert(eventConsumerReceipts)
    .values({ eventId, consumerName, status: 'applied' })
    .onConflictDoNothing()
    .returning({ eventId: eventConsumerReceipts.eventId })
  return rows.length === 1
}

const itemFromRow = (row: typeof inboxItems.$inferSelect): InboxItem => ({
  ...inboxItemFromRow(row),
  propertyName: null,
})

type PersistedHead = typeof inboxHandlingCycleHeads.$inferSelect

const handlingCycleHeadFromRow = (row: PersistedHead): HandlingCycleHead => ({
  inboxItemId: inboxItemId(row.inboxItemId),
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  sourceType: row.sourceType,
  sourceId:
    row.sourceType === 'review' ? reviewId(row.sourceId) : feedbackId(row.sourceId),
  currentCycleNumber: row.currentCycleNumber,
  currentSourceRevision: row.currentSourceRevision,
  stateRevision: row.stateRevision,
  status: row.status,
})

const lifecycleFactFor = (transition: HandlingCycleTransition): DomainEvent => {
  const scope = {
    inboxItemId: transition.inboxItemId,
    cycleNumber: transition.cycleNumber,
    stateRevision: transition.stateRevision,
    organizationId: transition.organizationId,
    propertyId: transition.propertyId,
    sourceType: transition.sourceType,
    sourceId: transition.sourceId,
    sourceRevision: transition.sourceRevision,
    actorType: transition.actorType,
    userId: transition.actorUserId,
    triggerEventId: transition.triggerEventId,
    occurredAt: transition.transitionedAt,
  }
  if (transition.kind === 'closed') {
    return inboxHandlingCycleClosed({
      ...scope,
      closeReason: transition.transitionReason as Parameters<
        typeof inboxHandlingCycleClosed
      >[0]['closeReason'],
      source: transition.actorType === 'user' ? 'web' : 'import',
    })
  }
  if (transition.kind === 'reopened') {
    return inboxHandlingCycleReopened({
      ...scope,
      reopenReason: transition.transitionReason as Parameters<
        typeof inboxHandlingCycleReopened
      >[0]['reopenReason'],
      source: transition.actorType === 'user' ? 'web' : 'import',
    })
  }
  return inboxHandlingCycleOpened({
    ...scope,
    openReason: transition.transitionReason as Parameters<
      typeof inboxHandlingCycleOpened
    >[0]['openReason'],
  })
}

async function insertNextHandlingCycleDecision(
  tx: Tx,
  decision: HandlingCycleDecision,
  createdAt: Date,
  responseTarget?: HandlingCycleCreationAnchor['responseTarget'],
): Promise<ReadonlyArray<DomainEvent>> {
  const superseded = decision.transitions.find(
    (transition) =>
      transition.kind === 'closed' &&
      transition.transitionReason === 'superseded_by_source_revision',
  )
  if (superseded) {
    await cancelResponseTargetForCycle(tx, {
      inboxItemId: superseded.inboxItemId,
      cycleNumber: superseded.cycleNumber,
      organizationId: superseded.organizationId,
      cancelledAt: createdAt,
      reason: 'superseded_by_source_revision',
    })
  }
  await tx.insert(inboxHandlingCycles).values(cycleInsert(decision.cycle, createdAt))
  if (responseTarget !== null) {
    await insertResponseTargetForHandlingCycle(
      tx,
      decision.cycle,
      createdAt,
      responseTarget,
    )
  }
  await tx
    .insert(inboxHandlingCycleTransitions)
    .values(
      decision.transitions.map((transition) => transitionInsert(transition, createdAt)),
    )
  return decision.transitions.map(lifecycleFactFor)
}

const normalizeCreationAnchor = (
  item: InboxItem,
  anchor: HandlingCycleCreationAnchor | ReviewCycleCreationAnchor,
): HandlingCycleCreationAnchor =>
  'materialReviewRevision' in anchor
    ? {
        sourceRevision: anchor.materialReviewRevision,
        openedReason:
          item.sourceType === 'review' ? 'review_observed' : 'legacy_backfill',
        actorType: 'provider',
        triggerEventId: null,
        openedAt: item.createdAt,
      }
    : anchor

const projectionTargetAnchor = (
  revision: import('../application/ports/review-response-target-authority.port').ReviewInboxProjectionRevisionPermit,
): import('../application/ports/review-response-target-authority.port').ReviewCycleTargetAnchor => ({
  reviewAuthority: revision,
  targetStart: { basis: 'review_provenance' },
})

function assertReviewProjectionCommand(
  command: import('../application/ports/inbox-command-store.port').ApplyReviewProjectionCommand,
): void {
  const { fact, item, projection } = command
  const validSourceState =
    projection.sourceContentState === 'active' ||
    projection.sourceContentState === 'source_expired' ||
    projection.sourceContentState === 'provider_deleted'
  if (
    item.sourceType !== 'review' ||
    projection.authority !== 'review.current-inbox-projection.v1' ||
    projection.organizationId !== item.organizationId ||
    projection.propertyId !== item.propertyId ||
    projection.reviewId !== item.sourceId ||
    projection.platform !== 'google' ||
    item.platform !== projection.platform ||
    item.sourceDate.getTime() !== projection.sourceDate.getTime() ||
    fact.inboxItemId !== item.id ||
    fact.organizationId !== item.organizationId ||
    fact.propertyId !== item.propertyId ||
    fact.sourceType !== 'review' ||
    fact.sourceId !== item.sourceId ||
    fact.occurredAt.getTime() !== item.createdAt.getTime() ||
    item.status !== 'open' ||
    item.rating !== null ||
    item.snippet !== null ||
    item.reviewerName !== null ||
    item.assignedTo !== null ||
    !validSourceState ||
    !Number.isSafeInteger(projection.sourceEpoch) ||
    projection.sourceEpoch < 0 ||
    !Number.isSafeInteger(projection.currentMaterialReviewRevision) ||
    projection.currentMaterialReviewRevision < 1 ||
    !Number.isFinite(command.now.getTime())
  ) {
    throw inboxError(
      'invalid_input',
      'Review Inbox projection authority does not match the projection command',
    )
  }
  const active = projection.sourceContentState === 'active'
  const erasedAt = projection.sourceContentErasedAt
  if (
    (active && erasedAt !== null) ||
    (!active && !(erasedAt instanceof Date)) ||
    (erasedAt instanceof Date && !Number.isFinite(erasedAt.getTime())) ||
    !Number.isFinite(projection.sourceDate.getTime()) ||
    projection.revisions.length === 0
  ) {
    throw inboxError('invalid_input', 'Review Inbox projection source state is invalid')
  }
  let previousObservedAt = Number.NEGATIVE_INFINITY
  for (const [index, revision] of projection.revisions.entries()) {
    if (
      revision.authority !== 'review.inbox-projection-revision.v1' ||
      revision.organizationId !== item.organizationId ||
      revision.propertyId !== item.propertyId ||
      revision.reviewId !== item.sourceId ||
      revision.sourceEpoch !== projection.sourceEpoch ||
      revision.materialReviewRevision !== index + 1 ||
      !Number.isFinite(revision.observedAt.getTime()) ||
      revision.observedAt.getTime() < previousObservedAt ||
      (revision.eligibility !== 'measured' &&
        revision.eligibility !== 'historical_onboarding' &&
        revision.eligibility !== 'legacy_unknown') ||
      (revision.eligibility === 'measured') !==
        revision.responseTargetStartAt instanceof Date ||
      (revision.responseTargetStartAt instanceof Date &&
        !Number.isFinite(revision.responseTargetStartAt.getTime()))
    ) {
      throw inboxError(
        'invalid_input',
        'Review Inbox projection revision history is invalid',
      )
    }
    previousObservedAt = revision.observedAt.getTime()
  }
  if (
    projection.revisions.at(-1)?.materialReviewRevision !==
      projection.currentMaterialReviewRevision ||
    item.createdAt.getTime() !== projection.revisions[0].observedAt.getTime() ||
    (erasedAt instanceof Date && erasedAt.getTime() < previousObservedAt)
  ) {
    throw inboxError(
      'invalid_input',
      'Review Inbox projection head does not match its revision history',
    )
  }
}

/**
 * Idempotent insert on the (sourceType, sourceId, organizationId) unique
 * anchor. Returns the inserted row, or the pre-existing row with
 * `created: false` after a re-select — never throws on the unique race.
 */
async function insertItemIdempotent(
  tx: Tx,
  item: InboxItem,
  cycleAnchor?: HandlingCycleCreationAnchor | ReviewCycleCreationAnchor,
): Promise<{
  item: InboxItem
  created: boolean
  openingFacts: ReadonlyArray<DomainEvent>
}> {
  const inserted = await tx
    .insert(inboxItems)
    .values(inboxItemToInsertRow(item))
    .onConflictDoNothing({
      target: [inboxItems.sourceType, inboxItems.sourceId, inboxItems.organizationId],
    })
    .returning()
  if (inserted[0]) {
    const insertedItem = itemFromRow(inserted[0])
    let openingFacts: ReadonlyArray<DomainEvent> = []
    if (cycleAnchor) {
      const decision = await insertInitialHandlingCycle(
        tx,
        insertedItem,
        normalizeCreationAnchor(insertedItem, cycleAnchor),
      )
      // Initial Review remains represented by inbox_item.created. Guest
      // private-feedback creation has its own canonical opened fact.
      if (insertedItem.sourceType === 'feedback') {
        openingFacts = decision.transitions.map(lifecycleFactFor)
      }
    }
    return { item: insertedItem, created: true, openingFacts }
  }
  const existing = await tx
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.sourceType, item.sourceType),
        eq(inboxItems.sourceId, item.sourceId as string),
        eq(inboxItems.organizationId, item.organizationId),
      ),
    )
    .limit(1)
  if (!existing[0]) {
    // Conflict without a visible row — the racing transaction rolled back
    // between our insert and re-select. Surface as a retryable failure.
    throw inboxError('not_found', 'Inbox item insert conflicted but no row is visible')
  }
  return { item: itemFromRow(existing[0]), created: false, openingFacts: [] }
}

/** Apply one human command only while its client-observed revision is current. */
async function tryUpdateItemRow(
  tx: Tx,
  item: InboxItem,
  set: Record<string, unknown>,
): Promise<InboxItem | null> {
  if (!Number.isSafeInteger(item.commandRevision) || item.commandRevision < 1) {
    throw inboxError('revision_conflict', 'Inbox command revision is invalid')
  }
  const nextCommandRevision = item.commandRevision + 1
  if (!Number.isSafeInteger(nextCommandRevision)) {
    throw inboxError('revision_conflict', 'Inbox command revision is exhausted')
  }
  const result = await tx
    .update(inboxItems)
    .set({ ...set, commandRevision: nextCommandRevision })
    .where(
      and(
        eq(inboxItems.id, item.id),
        eq(inboxItems.organizationId, item.organizationId),
        eq(inboxItems.commandRevision, item.commandRevision),
      ),
    )
    .returning()
  return result[0] ? itemFromRow(result[0]) : null
}

/** Single-row update mirroring InboxRepository's not_found contract. */
async function updateItemRow(
  tx: Tx,
  item: InboxItem,
  set: Record<string, unknown>,
  notFoundMessage: string,
): Promise<InboxItem> {
  const updated = await tryUpdateItemRow(tx, item, set)
  if (!updated) {
    const current = await tx
      .select({
        commandRevision: inboxItems.commandRevision,
        status: inboxItems.status,
        assignedTo: inboxItems.assignedTo,
        isEscalated: inboxItems.isEscalated,
        escalationResolvedAt: inboxItems.escalationResolvedAt,
      })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.id, item.id),
          eq(inboxItems.organizationId, item.organizationId),
        ),
      )
      .limit(1)
    if (current[0]) {
      throw inboxError('revision_conflict', 'Inbox item changed; reload current state', {
        expectedCommandRevision: item.commandRevision,
        currentCommandRevision: current[0].commandRevision,
        currentStatus: current[0].status,
        currentAssignedTo: current[0].assignedTo,
        currentEscalated:
          current[0].isEscalated && current[0].escalationResolvedAt === null,
      })
    }
    throw inboxError('not_found', notFoundMessage)
  }
  return updated
}

/**
 * Resolve the source Handling Cycle that owns a human assignment decision.
 *
 * This read intentionally happens before the Inbox item compare-and-swap and
 * does not lock the head. Cycle commands lock head -> item. If one of
 * those commands commits first, the item revision CAS rejects this command;
 * if this command wins the item row, the cycle observed here is the cycle in
 * which the assignment decision occurred.
 */
async function readCurrentCycleNumber(tx: Tx, item: InboxItem): Promise<number | null> {
  const rows = await tx
    .select({ currentCycleNumber: inboxHandlingCycleHeads.currentCycleNumber })
    .from(inboxHandlingCycleHeads)
    .where(
      and(
        eq(inboxHandlingCycleHeads.inboxItemId, item.id),
        eq(inboxHandlingCycleHeads.organizationId, item.organizationId),
        eq(inboxHandlingCycleHeads.propertyId, item.propertyId),
        eq(inboxHandlingCycleHeads.sourceType, item.sourceType),
        eq(inboxHandlingCycleHeads.sourceId, item.sourceId),
      ),
    )
    .limit(1)
  const cycleNumber = rows[0]?.currentCycleNumber
  return Number.isSafeInteger(cycleNumber) && cycleNumber >= 1 ? cycleNumber : null
}

async function currentAssignmentCycleNumber(
  tx: Tx,
  item: InboxItem,
): Promise<number | null> {
  const cycleNumber = await readCurrentCycleNumber(tx, item)
  if (cycleNumber === null) {
    throw inboxError(
      'not_found',
      'Inbox item has no current Handling Cycle for assignment',
    )
  }
  return cycleNumber
}

export const INBOX_ESCALATION_HISTORY_KINDS = ['escalated', 'resolved'] as const

export type InboxEscalationHistoryKind = (typeof INBOX_ESCALATION_HISTORY_KINDS)[number]

export type InboxEscalationHistoryEntry = Readonly<{
  inboxItemId: string
  resultingCommandRevision: number
  handlingCycleNumber: number | null
  kind: InboxEscalationHistoryKind
  actorUserId: string | null
  occurredAt: Date
}>

/**
 * `recorded` — every escalation decision on this item is present below.
 * `legacy_unknown` — the item carries escalation flags written before
 * migration 0169, so its earlier decisions have no actor and no time that this
 * system can honestly name. It is never back-filled with an invented value.
 */
export type InboxEscalationProvenance = 'recorded' | 'legacy_unknown'

export type InboxEscalationHistoryView = Readonly<{
  provenance: InboxEscalationProvenance
  currentlyEscalated: boolean
  entries: readonly InboxEscalationHistoryEntry[]
}>

/**
 * Append one escalation decision keyed by the command revision it produced.
 *
 * `handlingCycleNumber` is read after the item compare-and-swap has taken the
 * row lock, so the cycle recorded here is the cycle the decision landed in.
 * It stays nullable: an item whose Handling Cycle head is still awaiting
 * repair must still be able to record that it was escalated.
 */
async function appendEscalationHistory(
  tx: Tx,
  item: InboxItem,
  row: InboxItem,
  decision: Readonly<{
    kind: InboxEscalationHistoryKind
    actorUserId: string
    occurredAt: Date
  }>,
): Promise<void> {
  const handlingCycleNumber = await readCurrentCycleNumber(tx, item)
  await tx.insert(inboxEscalationHistory).values({
    inboxItemId: row.id,
    resultingCommandRevision: row.commandRevision,
    organizationId: item.organizationId,
    propertyId: item.propertyId,
    handlingCycleNumber,
    kind: decision.kind,
    actorUserId: decision.actorUserId,
    occurredAt: decision.occurredAt,
  })
}

/**
 * Read the complete escalation history of one Inbox item.
 *
 * Escalation is an independent workflow dimension (ADR 0023): this read grants
 * no access and never reports a status. An item whose flags predate migration
 * 0169 is still readable — it is reported as `legacy_unknown` so a manager
 * sees "escalated, provenance unknown" instead of a fabricated actor/time.
 */
export async function readInboxEscalationHistory(
  db: Database,
  item: Readonly<{ id: string; organizationId: string }>,
): Promise<InboxEscalationHistoryView> {
  const [heads, rows] = await Promise.all([
    db
      .select({
        isEscalated: inboxItems.isEscalated,
        escalatedAt: inboxItems.escalatedAt,
        escalationResolvedAt: inboxItems.escalationResolvedAt,
      })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.id, item.id),
          eq(inboxItems.organizationId, item.organizationId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(inboxEscalationHistory)
      .where(eq(inboxEscalationHistory.inboxItemId, item.id))
      .orderBy(
        inboxEscalationHistory.occurredAt,
        inboxEscalationHistory.resultingCommandRevision,
      ),
  ])
  const head = heads[0]
  if (!head) throw inboxError('not_found', 'Inbox item was not found')
  const entries = rows.map((row) => ({
    inboxItemId: row.inboxItemId,
    resultingCommandRevision: row.resultingCommandRevision,
    handlingCycleNumber: row.handlingCycleNumber,
    kind: row.kind as InboxEscalationHistoryKind,
    actorUserId: row.actorUserId,
    occurredAt: row.occurredAt,
  }))
  const everEscalated = head.escalatedAt !== null || head.escalationResolvedAt !== null
  return {
    provenance: everEscalated && entries.length === 0 ? 'legacy_unknown' : 'recorded',
    currentlyEscalated: head.isEscalated && head.escalationResolvedAt === null,
    entries,
  }
}

export const createAtomicInboxCommandStore = (
  db: Database,
  events: EventBus,
  authorizeCommand: InboxCommandAuthority,
  clock: () => Date,
): InboxCommandStore => {
  const assertCommandAuthority = async (
    tx: Tx,
    organizationId: string,
    at: Date,
    requirements: readonly InboxCommandAuthorityRequirement[],
  ): Promise<void> => {
    if (requirements.length === 0) return
    const decision = await authorizeCommand(tx, {
      organizationId,
      at,
      requirements,
    })
    if (!decision.allowed) {
      throw inboxError('forbidden', 'Inbox command authority is no longer current', {
        authorityReason: decision.reason,
      })
    }
  }

  const authorityRequirements = (
    item: InboxItem,
    principals: readonly InboxCommandAuthorityPrincipal[],
  ): InboxCommandAuthorityRequirement[] =>
    principals.map((principal) => ({ ...principal, propertyId: item.propertyId }))

  const actorPrincipals = (
    item: InboxItem,
    event: DomainEvent | null,
    extraPermissions: readonly Permission[] = [],
  ): InboxCommandAuthorityPrincipal[] => {
    const actorId = webActorId(event)
    return actorId === null
      ? []
      : [
          {
            userId: actorId,
            permissions: [
              'inbox.write',
              sourceCommandPermission(item.sourceType),
              ...extraPermissions,
            ],
            purpose: 'actor',
          },
        ]
  }

  type ReleaseInput = Readonly<{
    organizationId: OrganizationId
    userId: UserId
    actorId: UserId | null
    at: Date
  }>

  /**
   * Clear a preselected set in canonical lock order. Review heads are locked
   * before Inbox items to match Handling Cycle commands; Inbox rows are then
   * locked and updated by item ID. A racing release is an idempotent no-op.
   */
  const releaseAssignmentRows = async (
    tx: Tx,
    input: ReleaseInput,
    candidateIds: readonly string[],
  ): Promise<ReturnType<typeof inboxItemUnassigned>[]> => {
    if (candidateIds.length === 0) return []

    const reviewCycleRows = await tx
      .select({
        inboxItemId: inboxHandlingCycleHeads.inboxItemId,
        currentCycleNumber: inboxHandlingCycleHeads.currentCycleNumber,
      })
      .from(inboxHandlingCycleHeads)
      .innerJoin(
        inboxItems,
        and(
          eq(inboxItems.id, inboxHandlingCycleHeads.inboxItemId),
          eq(inboxItems.organizationId, inboxHandlingCycleHeads.organizationId),
          // Canonical heads use uuid while the expand-phase Inbox projection
          // still accepts legacy text. Cast the canonical side so a legacy
          // value cannot abort this authority-removal path.
          sql`${inboxHandlingCycleHeads.propertyId}::text = ${inboxItems.propertyId}`,
          eq(inboxItems.sourceType, inboxHandlingCycleHeads.sourceType),
          eq(inboxItems.sourceId, inboxHandlingCycleHeads.sourceId),
        ),
      )
      .where(
        and(
          eq(inboxItems.organizationId, input.organizationId),
          eq(inboxItems.assignedTo, input.userId),
          inArray(inboxItems.id, [...candidateIds]),
        ),
      )
      .orderBy(inboxHandlingCycleHeads.inboxItemId)
      .for('share', { of: inboxHandlingCycleHeads })
    const cycleByItem = new Map(
      reviewCycleRows.map((row) => [row.inboxItemId, row.currentCycleNumber]),
    )

    const lockedRows = await tx
      .select()
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.organizationId, input.organizationId),
          eq(inboxItems.assignedTo, input.userId),
          inArray(inboxItems.id, [...candidateIds]),
        ),
      )
      .orderBy(inboxItems.id)
      .for('update')

    const facts: ReturnType<typeof inboxItemUnassigned>[] = []
    for (const current of lockedRows) {
      const [row] = await tx
        .update(inboxItems)
        .set({
          assignedTo: null,
          commandRevision: sql<number>`${inboxItems.commandRevision} + 1`,
          updatedAt: input.at,
        })
        .where(
          and(
            eq(inboxItems.id, current.id),
            eq(inboxItems.organizationId, input.organizationId),
            eq(inboxItems.assignedTo, input.userId),
          ),
        )
        .returning()
      if (!row) continue

      await tx.insert(inboxAssignmentHistory).values({
        inboxItemId: row.id,
        resultingCommandRevision: row.commandRevision,
        organizationId: row.organizationId,
        propertyId: row.propertyId,
        handlingCycleNumber: cycleByItem.get(row.id) ?? null,
        previousAssignee: input.userId,
        nextAssignee: null,
        reason: 'eligibility_lost',
        actorUserId: input.actorId,
        bulkId: null,
        occurredAt: input.at,
      })
      const fact = inboxItemUnassigned({
        inboxItemId: inboxItemId(row.id),
        organizationId: organizationId(row.organizationId),
        propertyId: propertyId(row.propertyId),
        userId: input.actorId ?? undefined,
        previousAssignee: input.userId,
        source: 'web',
        occurredAt: input.at,
      })
      await insertOutboxRow(tx, fact)
      facts.push(fact)
    }
    return facts
  }

  /**
   * Shared runner: single-row update + optional fact, one transaction.
   *
   * `appendHistory` runs between the compare-and-swap and the outbox insert so
   * an append-only history row, the projection update and the fact either all
   * commit or none do.
   */
  const transition = async (
    span: string,
    item: InboxItem,
    set: Record<string, unknown>,
    notFoundMessage: string,
    event: DomainEvent | null,
    at: Date,
    appendHistory?: (tx: Tx, row: InboxItem) => Promise<void>,
  ): Promise<InboxItem> => {
    return trace(span, async () => {
      const saved = await db.transaction(async (tx) => {
        await assertCommandAuthority(
          tx,
          item.organizationId,
          event?.occurredAt ?? at,
          authorityRequirements(item, actorPrincipals(item, event)),
        )
        const row = await updateItemRow(tx, item, set, notFoundMessage)
        if (appendHistory) await appendHistory(tx, row)
        if (event) await insertOutboxRow(tx, event)
        return row
      })
      if (event) await emitAfterCommit(events, event)
      return saved
    })
  }

  return {
    releaseAssignmentsForUser: async (input) => {
      return trace('inbox.commandStore.releaseAssignmentsForUser', async () => {
        const facts = await db.transaction(async (tx) => {
          const candidates = await tx
            .select({ id: inboxItems.id })
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.organizationId, input.organizationId),
                eq(inboxItems.assignedTo, input.userId),
              ),
            )
            .orderBy(inboxItems.id)
          return releaseAssignmentRows(
            tx,
            input,
            candidates.map((candidate) => candidate.id),
          )
        })
        for (const event of facts) await emitAfterCommit(events, event)
        return { released: facts.length }
      })
    },

    releaseIneligibleAssignmentsForUser: async (input) => {
      return trace('inbox.commandStore.releaseIneligibleAssignmentsForUser', async () => {
        const facts = await db.transaction(async (tx) => {
          const candidates = await tx
            .select({
              id: inboxItems.id,
              propertyId: inboxItems.propertyId,
              sourceType: inboxItems.sourceType,
            })
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.organizationId, input.organizationId),
                eq(inboxItems.assignedTo, input.userId),
              ),
            )
            .orderBy(inboxItems.id)
          const requirements = [
            ...new Map(
              candidates.map((candidate) => [
                assignmentAuthorityKey(candidate.propertyId, candidate.sourceType),
                {
                  propertyId: candidate.propertyId,
                  sourceType: candidate.sourceType,
                },
              ]),
            ).values(),
          ].sort(
            (left, right) =>
              left.propertyId.localeCompare(right.propertyId) ||
              left.sourceType.localeCompare(right.sourceType),
          )
          const denied = new Set<string>()
          for (const requirement of requirements) {
            const key = assignmentAuthorityKey(
              requirement.propertyId,
              requirement.sourceType,
            )
            // No canonical Property authority can ever match a retained
            // legacy text key. Release it without casting through uuid.
            if (!UUID_TEXT.test(requirement.propertyId)) {
              denied.add(key)
              continue
            }
            const decision = await authorizeCommand(tx, {
              organizationId: input.organizationId,
              at: input.at,
              requirements: [
                {
                  propertyId: requirement.propertyId,
                  userId: input.userId,
                  permissions: [
                    'inbox.write',
                    sourceCommandPermission(requirement.sourceType),
                  ],
                  purpose: 'assignee',
                },
              ],
            })
            if (decision.allowed) continue
            if (
              decision.reason.includes('authority_changed') ||
              decision.reason.includes('contract_mismatch')
            ) {
              throw inboxError(
                'revision_conflict',
                'Inbox assignment authority changed during reconciliation',
                { authorityReason: decision.reason },
              )
            }
            denied.add(key)
          }
          const candidateIds = candidates
            .filter((candidate) =>
              denied.has(
                assignmentAuthorityKey(candidate.propertyId, candidate.sourceType),
              ),
            )
            .map((candidate) => candidate.id)
          return releaseAssignmentRows(tx, input, candidateIds)
        })
        for (const event of facts) await emitAfterCommit(events, event)
        return { released: facts.length }
      })
    },

    createItem: async (item, event, reviewCycleAnchor) => {
      return trace('inbox.commandStore.createItem', async () => {
        const result = await db.transaction(async (tx) => {
          const inserted = await insertItemIdempotent(tx, item, reviewCycleAnchor)
          if (inserted.created && event) {
            await insertOutboxRow(tx, event)
            for (const fact of inserted.openingFacts) await insertOutboxRow(tx, fact)
          }
          return inserted
        })
        if (result.created && event) {
          await emitAfterCommit(events, event)
          for (const fact of result.openingFacts) await emitAfterCommit(events, fact)
        }
        return result
      })
    },

    updateStatus: async (item, updates, event, now) => {
      const stamp = now ?? clock()
      if (event === null || updates.status !== 'closed' || item.status !== 'open') {
        return transition(
          'inbox.commandStore.updateStatus',
          item,
          {
            status: updates.status,
            updatedAt: stamp,
            ...updates.timestampFields,
          },
          'Inbox item status update failed — no row returned',
          event,
          stamp,
        )
      }
      if (item.sourceType !== 'feedback') {
        throw inboxError(
          'invalid_input',
          'Review Handling Cycles close only from provider authority',
        )
      }
      const actorId = webActorId(event)
      if (actorId === null) {
        throw inboxError('invalid_input', 'Feedback close requires a user actor')
      }
      const committed = await db.transaction(async (tx) => {
        const [headRow] = await tx
          .select()
          .from(inboxHandlingCycleHeads)
          .where(
            and(
              eq(inboxHandlingCycleHeads.inboxItemId, item.id),
              eq(inboxHandlingCycleHeads.organizationId, item.organizationId),
              eq(inboxHandlingCycleHeads.sourceType, 'feedback'),
              eq(inboxHandlingCycleHeads.sourceId, item.sourceId),
            ),
          )
          .for('update')
          .limit(1)
        if (!headRow || headRow.status !== 'open') {
          throw inboxError(
            'revision_conflict',
            'Feedback Handling Cycle changed; reload current state',
          )
        }
        await assertCommandAuthority(
          tx,
          item.organizationId,
          stamp,
          authorityRequirements(item, actorPrincipals(item, event)),
        )
        const decision = closeHandlingCycle({
          current: handlingCycleHeadFromRow(headRow),
          closeReason: 'private_feedback_handled',
          actorType: 'user',
          actorUserId: userId(actorId),
          triggerEventId: event.eventId,
          closedAt: stamp,
        })
        if (decision.isErr()) throw decision.error
        const cycleFact = lifecycleFactFor(decision.value.transition)
        await tx
          .insert(inboxHandlingCycleTransitions)
          .values(transitionInsert(decision.value.transition, stamp))
        const [updatedHead] = await tx
          .update(inboxHandlingCycleHeads)
          .set({
            stateRevision: decision.value.head.stateRevision,
            status: 'closed',
            updatedAt: stamp,
          })
          .where(
            and(
              eq(inboxHandlingCycleHeads.inboxItemId, item.id),
              eq(inboxHandlingCycleHeads.stateRevision, headRow.stateRevision),
              eq(inboxHandlingCycleHeads.status, 'open'),
            ),
          )
          .returning({ id: inboxHandlingCycleHeads.inboxItemId })
        if (!updatedHead) {
          throw inboxError('revision_conflict', 'Feedback Handling Cycle changed')
        }
        const saved = await updateItemRow(
          tx,
          item,
          {
            status: 'closed',
            updatedAt: stamp,
            ...updates.timestampFields,
          },
          'Feedback Inbox item close failed',
        )
        await insertOutboxRow(tx, event)
        await insertOutboxRow(tx, cycleFact)
        return { saved, cycleFact }
      })
      await emitAfterCommit(events, event)
      await emitAfterCommit(events, committed.cycleFact)
      return committed.saved
    },

    reopenReviewCycle: async (command) => {
      return trace('inbox.commandStore.reopenReviewCycle', async () => {
        const { item, fact, expected, now } = command
        const actorId = webActorId(fact)
        const expectedSourceRevision =
          'sourceRevision' in expected
            ? expected.sourceRevision
            : expected.materialReviewRevision
        if (
          actorId === null ||
          fact.inboxItemId !== item.id ||
          fact.organizationId !== item.organizationId ||
          fact.propertyId !== item.propertyId ||
          fact.oldStatus !== 'closed' ||
          fact.newStatus !== 'open' ||
          fact.occurredAt.getTime() !== now.getTime()
        ) {
          throw inboxError(
            'invalid_input',
            'Manual reopen fact does not match the Inbox command',
          )
        }

        const committed = await db.transaction(async (tx) => {
          const headRows = await tx
            .select()
            .from(inboxHandlingCycleHeads)
            .where(
              and(
                eq(inboxHandlingCycleHeads.inboxItemId, item.id),
                eq(inboxHandlingCycleHeads.organizationId, item.organizationId),
                eq(inboxHandlingCycleHeads.sourceType, item.sourceType),
                eq(inboxHandlingCycleHeads.sourceId, item.sourceId),
              ),
            )
            .for('update')
            .limit(1)
          const itemRows = await tx
            .select()
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.id, item.id),
                eq(inboxItems.organizationId, item.organizationId),
                eq(inboxItems.sourceType, item.sourceType),
                eq(inboxItems.sourceId, item.sourceId),
              ),
            )
            .for('update')
            .limit(1)
          const headRow = headRows[0]
          const itemRow = itemRows[0]
          if (!headRow || !itemRow) {
            throw inboxError(
              'not_found',
              'Inbox item or current Handling Cycle was not found',
            )
          }
          const expectedMatches =
            headRow.currentCycleNumber === expected.cycleNumber &&
            headRow.currentSourceRevision === expectedSourceRevision &&
            headRow.stateRevision === expected.stateRevision
          if (
            !expectedMatches ||
            headRow.status !== 'closed' ||
            itemRow.status !== headRow.status ||
            itemRow.commandRevision !== item.commandRevision
          ) {
            throw inboxError(
              'revision_conflict',
              'Inbox Handling Cycle changed; reload current state',
              {
                expected,
                current: {
                  cycleNumber: headRow.currentCycleNumber,
                  sourceRevision: headRow.currentSourceRevision,
                  stateRevision: headRow.stateRevision,
                  status: headRow.status,
                  commandRevision: itemRow.commandRevision,
                },
              },
            )
          }

          const currentItem = itemFromRow(itemRow)
          await assertCommandAuthority(
            tx,
            currentItem.organizationId,
            now,
            authorityRequirements(currentItem, actorPrincipals(currentItem, fact)),
          )
          const decision = createNextHandlingCycle({
            current: handlingCycleHeadFromRow(headRow),
            sourceRevision: headRow.currentSourceRevision,
            openedReason: 'manual_reopen',
            manualReopenReason: command.reason,
            manualReopenExplanation: command.explanation,
            openedBy: userId(actorId),
            actorType: 'user',
            triggerEventId: fact.eventId,
            openedAt: now,
          })
          if (decision.isErr()) throw decision.error

          let assignedTo = itemRow.assignedTo
          let unassignedFact: ReturnType<typeof inboxItemUnassigned> | null = null
          if (assignedTo !== null) {
            const eligibility = await authorizeCommand(tx, {
              organizationId: itemRow.organizationId,
              at: now,
              requirements: [
                {
                  propertyId: itemRow.propertyId,
                  userId: assignedTo,
                  permissions: ['inbox.write', sourceCommandPermission(item.sourceType)],
                  purpose: 'assignee',
                },
              ],
            })
            if (!eligibility.allowed) {
              if (
                eligibility.reason.includes('authority_changed') ||
                eligibility.reason.includes('contract_mismatch')
              ) {
                throw inboxError(
                  'revision_conflict',
                  'Inbox assignment authority changed during reopen',
                  { authorityReason: eligibility.reason },
                )
              }
              unassignedFact = inboxItemUnassigned({
                inboxItemId: item.id,
                organizationId: item.organizationId,
                propertyId: item.propertyId,
                userId: userId(actorId),
                previousAssignee: userId(assignedTo),
                source: 'web',
                occurredAt: now,
              })
              assignedTo = null
            }
          }

          const cycleFacts = await insertNextHandlingCycleDecision(
            tx,
            decision.value,
            now,
            command.responseTarget,
          )
          const [updatedHead] = await tx
            .update(inboxHandlingCycleHeads)
            .set({
              currentCycleNumber: decision.value.head.currentCycleNumber,
              currentSourceRevision: decision.value.head.currentSourceRevision,
              ...(item.sourceType === 'review'
                ? {
                    currentMaterialReviewRevision:
                      decision.value.head.currentSourceRevision,
                  }
                : {}),
              stateRevision: decision.value.head.stateRevision,
              status: 'open',
              updatedAt: now,
            })
            .where(
              and(
                eq(inboxHandlingCycleHeads.inboxItemId, item.id),
                eq(inboxHandlingCycleHeads.organizationId, item.organizationId),
                eq(inboxHandlingCycleHeads.currentCycleNumber, expected.cycleNumber),
                eq(inboxHandlingCycleHeads.currentSourceRevision, expectedSourceRevision),
                eq(inboxHandlingCycleHeads.stateRevision, expected.stateRevision),
                eq(inboxHandlingCycleHeads.status, 'closed'),
              ),
            )
            .returning({ id: inboxHandlingCycleHeads.inboxItemId })
          if (!updatedHead) {
            throw inboxError(
              'revision_conflict',
              'Inbox Handling Cycle changed during reopen',
            )
          }
          const [updatedItem] = await tx
            .update(inboxItems)
            .set({
              status: 'open',
              closedAt: null,
              assignedTo,
              commandRevision: item.commandRevision + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(inboxItems.id, item.id),
                eq(inboxItems.organizationId, item.organizationId),
                eq(inboxItems.commandRevision, item.commandRevision),
                eq(inboxItems.status, 'closed'),
              ),
            )
            .returning()
          if (!updatedItem) {
            throw inboxError('revision_conflict', 'Inbox item changed during reopen')
          }
          if (unassignedFact) {
            await tx.insert(inboxAssignmentHistory).values({
              inboxItemId: item.id,
              resultingCommandRevision: updatedItem.commandRevision,
              organizationId: item.organizationId,
              propertyId: item.propertyId,
              handlingCycleNumber: decision.value.head.currentCycleNumber,
              previousAssignee: itemRow.assignedTo,
              nextAssignee: null,
              reason: 'eligibility_lost',
              actorUserId: actorId,
              bulkId: null,
              occurredAt: now,
            })
          }
          await insertOutboxRow(tx, fact)
          for (const cycleFact of cycleFacts) await insertOutboxRow(tx, cycleFact)
          if (unassignedFact) await insertOutboxRow(tx, unassignedFact)
          return {
            item: itemFromRow(updatedItem),
            unassignedFact,
            cycleFacts,
          }
        })
        await emitAfterCommit(events, fact)
        for (const cycleFact of committed.cycleFacts) {
          await emitAfterCommit(events, cycleFact)
        }
        if (committed.unassignedFact) {
          await emitAfterCommit(events, committed.unassignedFact)
        }
        return committed.item
      })
    },

    bulkUpdateStatus: async (items, perItemEvents, governance, reviewResponseTargets) => {
      return trace('inbox.commandStore.bulkUpdateStatus', async () => {
        if (items.length === 0 && perItemEvents.length === 0) {
          return { updated: 0, results: [] }
        }
        const first = perItemEvents[0]
        if (!first || perItemEvents.length !== items.length) {
          throw inboxError(
            'invalid_input',
            'Inbox bulk status command items and facts must match',
          )
        }
        if (first.newStatus !== 'open') {
          throw inboxError('invalid_input', 'Inbox bulk close is unavailable')
        }
        const explanation = governance.explanation?.trim() || null
        if (
          (governance.reason === 'other' && explanation === null) ||
          (governance.reason !== 'other' && explanation !== null)
        ) {
          throw inboxError(
            'invalid_input',
            'Inbox bulk reopen reason and explanation are inconsistent',
          )
        }
        const mismatched = items.some((item, index) => {
          const event = perItemEvents[index]
          return (
            !event ||
            event.inboxItemId !== item.id ||
            event.organizationId !== item.organizationId ||
            event.propertyId !== item.propertyId ||
            event.oldStatus !== item.status ||
            event.newStatus !== first.newStatus ||
            event.bulkId !== first.bulkId ||
            event.occurredAt.getTime() !== first.occurredAt.getTime()
          )
        })
        if (mismatched) {
          throw inboxError(
            'invalid_input',
            'Inbox bulk status facts do not match their command items',
          )
        }
        const now = first.occurredAt
        const committed = await db.transaction(async (tx) => {
          // Each row is revision-fenced, while all row changes and per-item
          // facts still commit atomically as one bulk command.
          const commandOrganizationId = items[0]?.organizationId
          if (
            commandOrganizationId === undefined ||
            items.some((item) => item.organizationId !== commandOrganizationId)
          ) {
            throw inboxError(
              'invalid_input',
              'Inbox bulk status command must target one Organization',
            )
          }
          const requirements = items.flatMap((item, index) =>
            authorityRequirements(
              item,
              actorPrincipals(item, perItemEvents[index] ?? null),
            ),
          )
          await assertCommandAuthority(tx, commandOrganizationId, now, requirements)
          const results: Array<
            | {
                inboxItemId: (typeof items)[number]['id']
                outcome: 'reopened' | 'revision_conflict'
              }
            | undefined
          > = new Array(items.length)
          const ordered = items
            .map((item, originalIndex) => ({
              item,
              event: perItemEvents[originalIndex]!,
              originalIndex,
            }))
            .sort((left, right) => left.item.id.localeCompare(right.item.id))

          // Canonical lock order is all source heads by item ID, followed by
          // all Inbox rows by item ID. Opposite-order overlapping batches can
          // therefore wait, but cannot deadlock or observe a split authority.
          const cycleIds = ordered.map(({ item }) => item.id)
          const headRows =
            cycleIds.length === 0
              ? []
              : await tx
                  .select()
                  .from(inboxHandlingCycleHeads)
                  .where(
                    and(
                      eq(inboxHandlingCycleHeads.organizationId, commandOrganizationId),
                      inArray(inboxHandlingCycleHeads.inboxItemId, [...cycleIds]),
                    ),
                  )
                  .orderBy(inboxHandlingCycleHeads.inboxItemId)
                  .for('update')
          const lockedItemRows = await tx
            .select()
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.organizationId, commandOrganizationId),
                inArray(
                  inboxItems.id,
                  ordered.map(({ item }) => item.id),
                ),
              ),
            )
            .orderBy(inboxItems.id)
            .for('update')
          const headByItemId = new Map(headRows.map((row) => [row.inboxItemId, row]))
          const itemById = new Map(lockedItemRows.map((row) => [row.id, row]))
          const appliedEvents: DomainEvent[] = []

          for (const { event, item, originalIndex } of ordered) {
            const itemRow = itemById.get(item.id)
            const headRow = headByItemId.get(item.id)
            const exactItem =
              itemRow !== undefined &&
              itemRow.organizationId === item.organizationId &&
              itemRow.propertyId === item.propertyId &&
              itemRow.sourceType === item.sourceType &&
              itemRow.sourceId === item.sourceId &&
              itemRow.commandRevision === item.commandRevision &&
              itemRow.status === 'closed'
            const exactHead =
              headRow !== undefined &&
              headRow.organizationId === item.organizationId &&
              headRow.propertyId === item.propertyId &&
              headRow.sourceType === item.sourceType &&
              headRow.sourceId === item.sourceId &&
              headRow.status === 'closed' &&
              itemRow?.status === headRow.status
            if (!exactItem || !exactHead) {
              results[originalIndex] = {
                inboxItemId: item.id,
                outcome: 'revision_conflict',
              }
              continue
            }

            const actorId = webActorId(event)
            if (actorId === null) {
              throw inboxError(
                'invalid_input',
                'Inbox bulk reopen requires an authenticated web actor',
              )
            }
            let assignedTo = itemRow.assignedTo
            let unassignedFact: ReturnType<typeof inboxItemUnassigned> | null = null
            if (assignedTo !== null) {
              const eligibility = await authorizeCommand(tx, {
                organizationId: itemRow.organizationId,
                at: now,
                requirements: [
                  {
                    propertyId: itemRow.propertyId,
                    userId: assignedTo,
                    permissions: [
                      'inbox.write',
                      sourceCommandPermission(itemRow.sourceType),
                    ],
                    purpose: 'assignee',
                  },
                ],
              })
              if (!eligibility.allowed) {
                if (
                  eligibility.reason.includes('authority_changed') ||
                  eligibility.reason.includes('contract_mismatch')
                ) {
                  throw inboxError(
                    'revision_conflict',
                    'Inbox assignment authority changed during bulk reopen',
                    { authorityReason: eligibility.reason },
                  )
                }
                unassignedFact = inboxItemUnassigned({
                  inboxItemId: item.id,
                  organizationId: item.organizationId,
                  propertyId: item.propertyId,
                  userId: userId(actorId),
                  previousAssignee: userId(assignedTo),
                  source: 'web',
                  occurredAt: now,
                })
                assignedTo = null
              }
            }

            if (!headRow) {
              throw inboxError(
                'revision_conflict',
                'Inbox Handling Cycle disappeared during bulk reopen',
              )
            }
            const decision = createNextHandlingCycle({
              current: handlingCycleHeadFromRow(headRow),
              sourceRevision: headRow.currentSourceRevision,
              openedReason: 'manual_reopen',
              manualReopenReason: governance.reason,
              manualReopenExplanation: explanation,
              openedBy: userId(actorId),
              actorType: 'user',
              triggerEventId: event.eventId,
              openedAt: now,
            })
            if (decision.isErr()) throw decision.error
            const handlingCycleNumber = decision.value.head.currentCycleNumber
            const cycleFacts = await insertNextHandlingCycleDecision(
              tx,
              decision.value,
              now,
              reviewResponseTargets?.get(item.id),
            )
            appliedEvents.push(...cycleFacts)
            const updatedHeads = await tx
              .update(inboxHandlingCycleHeads)
              .set({
                currentCycleNumber: decision.value.head.currentCycleNumber,
                currentSourceRevision: decision.value.head.currentSourceRevision,
                ...(item.sourceType === 'review'
                  ? {
                      currentMaterialReviewRevision:
                        decision.value.head.currentSourceRevision,
                    }
                  : {}),
                stateRevision: decision.value.head.stateRevision,
                status: 'open',
                updatedAt: now,
              })
              .where(
                and(
                  eq(inboxHandlingCycleHeads.inboxItemId, item.id),
                  eq(inboxHandlingCycleHeads.organizationId, item.organizationId),
                  eq(
                    inboxHandlingCycleHeads.currentCycleNumber,
                    headRow.currentCycleNumber,
                  ),
                  eq(inboxHandlingCycleHeads.stateRevision, headRow.stateRevision),
                  eq(inboxHandlingCycleHeads.status, 'closed'),
                ),
              )
              .returning({ inboxItemId: inboxHandlingCycleHeads.inboxItemId })
            if (!updatedHeads[0]) {
              throw inboxError(
                'revision_conflict',
                'Inbox Handling Cycle changed during bulk reopen',
              )
            }

            const row = await tryUpdateItemRow(tx, itemFromRow(itemRow), {
              status: 'open',
              closedAt: null,
              assignedTo,
              updatedAt: now,
            })
            if (!row) {
              throw inboxError(
                'revision_conflict',
                'Inbox item changed while its bulk reopen lock was held',
              )
            }
            if (unassignedFact) {
              await tx.insert(inboxAssignmentHistory).values({
                inboxItemId: item.id,
                resultingCommandRevision: row.commandRevision,
                organizationId: item.organizationId,
                propertyId: item.propertyId,
                handlingCycleNumber,
                previousAssignee: itemRow.assignedTo,
                nextAssignee: null,
                reason: 'eligibility_lost',
                actorUserId: actorId,
                bulkId: first.bulkId,
                occurredAt: now,
              })
              appliedEvents.push(unassignedFact)
            }
            results[originalIndex] = {
              inboxItemId: item.id,
              outcome: 'reopened',
            }
            appliedEvents.push(event)
          }
          for (const event of appliedEvents) await insertOutboxRow(tx, event)
          return {
            result: {
              updated: results.filter((result) => result?.outcome === 'reopened').length,
              results: results.filter(
                (
                  result,
                ): result is {
                  inboxItemId: (typeof items)[number]['id']
                  outcome: 'reopened' | 'revision_conflict'
                } => result !== undefined,
              ),
            },
            appliedEvents,
          }
        })
        for (const event of committed.appliedEvents) {
          await emitAfterCommit(events, event)
        }
        return committed.result
      })
    },

    bulkAssign: async (command) => {
      return trace('inbox.commandStore.bulkAssign', async () => {
        const { items, assignedTo, actorId, bulkId, occurredAt } = command
        const itemIds = items.map((item) => item.id)
        const commandOrganizationId = items[0]?.organizationId
        if (
          items.length === 0 ||
          items.length > 100 ||
          new Set(itemIds).size !== items.length ||
          commandOrganizationId === undefined ||
          items.some((item) => item.organizationId !== commandOrganizationId) ||
          !UUID_TEXT.test(bulkId)
        ) {
          throw inboxError('invalid_input', 'Inbox bulk assignment command is invalid')
        }

        const committed = await db.transaction(async (tx) => {
          const ordered = [...items].sort((left, right) =>
            left.id.localeCompare(right.id),
          )
          const cycleItems = ordered

          // Canonical workflow lock order: every Review head, then every Inbox
          // row, both sorted by stable Inbox identity. A shared head lock keeps
          // each history row anchored to the cycle that owned the assignment.
          const headRows =
            cycleItems.length === 0
              ? []
              : await tx
                  .select()
                  .from(inboxHandlingCycleHeads)
                  .where(
                    and(
                      eq(inboxHandlingCycleHeads.organizationId, commandOrganizationId),
                      inArray(
                        inboxHandlingCycleHeads.inboxItemId,
                        cycleItems.map((item) => item.id),
                      ),
                    ),
                  )
                  .orderBy(inboxHandlingCycleHeads.inboxItemId)
                  .for('share')
          const lockedRows = await tx
            .select()
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.organizationId, commandOrganizationId),
                inArray(inboxItems.id, [...itemIds]),
              ),
            )
            .orderBy(inboxItems.id)
            .for('update')
          const headByItemId = new Map(headRows.map((row) => [row.inboxItemId, row]))
          const rowByItemId = new Map(lockedRows.map((row) => [row.id, row]))
          const exact = items.every((item) => {
            const row = rowByItemId.get(item.id)
            const head = headByItemId.get(item.id)
            return (
              row !== undefined &&
              row.organizationId === item.organizationId &&
              row.propertyId === item.propertyId &&
              row.sourceType === item.sourceType &&
              row.sourceId === item.sourceId &&
              row.status === item.status &&
              row.assignedTo === item.assignedTo &&
              row.commandRevision === item.commandRevision &&
              head !== undefined &&
              head.organizationId === item.organizationId &&
              head.propertyId === item.propertyId &&
              head.sourceType === item.sourceType &&
              head.sourceId === item.sourceId &&
              head.status === item.status
            )
          })
          if (!exact) {
            return {
              result: {
                updated: 0,
                results: items.map((item) => ({
                  inboxItemId: item.id,
                  outcome: 'revision_conflict' as const,
                })),
              },
              facts: [] as DomainEvent[],
            }
          }

          const requirements = ordered.flatMap((item) => {
            const principals: InboxCommandAuthorityPrincipal[] = [
              {
                userId: actorId,
                permissions: [
                  'inbox.write',
                  sourceCommandPermission(item.sourceType),
                  'inbox.manage',
                ],
                purpose: 'actor',
              },
            ]
            if (assignedTo !== null) {
              principals.push({
                userId: assignedTo,
                permissions: ['inbox.write', sourceCommandPermission(item.sourceType)],
                purpose: 'assignee',
              })
            }
            return authorityRequirements(item, principals)
          })
          await assertCommandAuthority(
            tx,
            commandOrganizationId,
            occurredAt,
            requirements,
          )

          const facts: DomainEvent[] = []
          const outcomeByItemId = new Map<
            string,
            'assigned' | 'reassigned' | 'released' | 'unchanged'
          >()
          const transitions = [] as Array<{
            inboxItemId: (typeof items)[number]['id']
            propertyId: (typeof items)[number]['propertyId']
            previousAssignee: UserId | null
            nextAssignee: UserId | null
          }>
          for (const item of ordered) {
            const current = rowByItemId.get(item.id)!
            const previousAssignee = current.assignedTo
              ? userId(current.assignedTo)
              : null
            if (previousAssignee === assignedTo) {
              outcomeByItemId.set(item.id, 'unchanged')
              continue
            }
            const row = await tryUpdateItemRow(tx, itemFromRow(current), {
              assignedTo,
              updatedAt: occurredAt,
            })
            if (!row) {
              throw inboxError(
                'revision_conflict',
                'Inbox item changed while its bulk assignment lock was held',
              )
            }
            const head = headByItemId.get(item.id)
            const outcome =
              assignedTo === null
                ? ('released' as const)
                : previousAssignee === null
                  ? ('assigned' as const)
                  : ('reassigned' as const)
            const fact = assignedTo
              ? inboxItemAssigned({
                  inboxItemId: item.id,
                  organizationId: item.organizationId,
                  propertyId: item.propertyId,
                  userId: actorId,
                  assignedTo,
                  bulkId,
                  source: 'web',
                  occurredAt,
                })
              : inboxItemUnassigned({
                  inboxItemId: item.id,
                  organizationId: item.organizationId,
                  propertyId: item.propertyId,
                  userId: actorId,
                  previousAssignee: previousAssignee!,
                  bulkId,
                  source: 'web',
                  occurredAt,
                })
            await tx.insert(inboxAssignmentHistory).values({
              inboxItemId: item.id,
              resultingCommandRevision: row.commandRevision,
              organizationId: item.organizationId,
              propertyId: item.propertyId,
              handlingCycleNumber: head?.currentCycleNumber ?? null,
              previousAssignee,
              nextAssignee: assignedTo,
              reason:
                assignedTo === null
                  ? 'release'
                  : previousAssignee === null
                    ? assignedTo === actorId
                      ? 'claim'
                      : 'assign'
                    : 'reassign',
              actorUserId: actorId,
              bulkId,
              occurredAt,
            })
            await insertOutboxRow(tx, fact)
            facts.push(fact)
            transitions.push({
              inboxItemId: item.id,
              propertyId: item.propertyId,
              previousAssignee,
              nextAssignee: assignedTo,
            })
            outcomeByItemId.set(item.id, outcome)
          }

          if (transitions.length > 0) {
            const completed = inboxBulkAssignmentCompleted({
              organizationId: organizationId(commandOrganizationId),
              userId: actorId,
              bulkId,
              transitions,
              occurredAt,
            })
            await insertOutboxRow(tx, completed)
            facts.push(completed)
          }
          return {
            result: {
              updated: transitions.length,
              results: items.map((item) => ({
                inboxItemId: item.id,
                outcome: outcomeByItemId.get(item.id)!,
              })),
            },
            facts,
          }
        })
        for (const fact of committed.facts) await emitAfterCommit(events, fact)
        return committed.result
      })
    },

    assign: async (item, updates, event, now) => {
      return trace('inbox.commandStore.assign', async () => {
        const stamp = now ?? clock()
        const saved = await db.transaction(async (tx) => {
          const actorId = webActorId(event)
          const touchesAnotherAssignee =
            actorId !== null &&
            ((updates.assignedTo !== null && updates.assignedTo !== actorId) ||
              (item.assignedTo !== null && item.assignedTo !== actorId))
          const principals = actorPrincipals(
            item,
            event,
            touchesAnotherAssignee ? ['inbox.manage'] : [],
          )
          if (updates.assignedTo !== null) {
            principals.push({
              userId: updates.assignedTo,
              permissions: ['inbox.write', sourceCommandPermission(item.sourceType)],
              purpose: 'assignee',
            })
          }
          await assertCommandAuthority(
            tx,
            item.organizationId,
            stamp,
            authorityRequirements(item, principals),
          )
          const handlingCycleNumber = event
            ? await currentAssignmentCycleNumber(tx, item)
            : null
          const row = await updateItemRow(
            tx,
            item,
            { assignedTo: updates.assignedTo, updatedAt: stamp },
            'Inbox item assignment update failed — no row returned',
          )
          if (event) {
            const reason =
              item.assignedTo === null
                ? updates.assignedTo === event.userId
                  ? 'claim'
                  : 'assign'
                : updates.assignedTo === null
                  ? 'release'
                  : 'reassign'
            await tx.insert(inboxAssignmentHistory).values({
              inboxItemId: item.id,
              resultingCommandRevision: row.commandRevision,
              organizationId: item.organizationId,
              propertyId: item.propertyId,
              handlingCycleNumber,
              previousAssignee: item.assignedTo,
              nextAssignee: updates.assignedTo,
              reason,
              actorUserId: event.userId,
              bulkId: null,
              occurredAt: stamp,
            })
            await insertOutboxRow(tx, event)
          }
          return row
        })
        if (event) await emitAfterCommit(events, event)
        return saved
      })
    },

    escalate: (item, updates, event, now) => {
      const stamp = now ?? clock()
      return transition(
        'inbox.commandStore.escalate',
        item,
        {
          isEscalated: true,
          escalatedAt: stamp,
          escalatedBy: updates.escalatedBy,
          escalationResolvedAt: null,
          escalationResolvedBy: null,
          updatedAt: stamp,
        },
        'Inbox item escalation update failed — no row returned',
        event,
        stamp,
        (tx, row) =>
          appendEscalationHistory(tx, item, row, {
            kind: 'escalated',
            actorUserId: updates.escalatedBy,
            occurredAt: stamp,
          }),
      )
    },

    resolveEscalation: (item, updates, event, now) => {
      const stamp = now ?? clock()
      return transition(
        'inbox.commandStore.resolveEscalation',
        item,
        {
          isEscalated: false,
          escalationResolvedAt: stamp,
          escalationResolvedBy: updates.resolvedBy,
          updatedAt: stamp,
        },
        'Inbox item resolve-escalation failed — no row returned',
        event,
        stamp,
        (tx, row) =>
          appendEscalationHistory(tx, item, row, {
            kind: 'resolved',
            actorUserId: updates.resolvedBy,
            occurredAt: stamp,
          }),
      )
    },

    addNote: async (item, note, event) => {
      return trace('inbox.commandStore.addNote', async () => {
        const saved = await db.transaction(async (tx) => {
          await assertCommandAuthority(
            tx,
            item.organizationId,
            note.createdAt,
            authorityRequirements(item, actorPrincipals(item, event)),
          )
          await updateItemRow(
            tx,
            item,
            { updatedAt: note.createdAt },
            'Inbox item note update failed — no row returned',
          )
          const result = await tx
            .insert(inboxNotes)
            .values(inboxNoteToInsertRow(note))
            .returning()
          if (!result[0]) {
            throw inboxError('not_found', 'Inbox note insert failed — no row returned')
          }
          await insertOutboxRow(tx, event)
          return inboxNoteFromRow(result[0])
        })
        await emitAfterCommit(events, event)
        return saved
      })
    },

    applySourceCreatedOnce: async (command) => {
      return trace('inbox.commandStore.applySourceCreatedOnce', async () => {
        const outcome = await db.transaction(async (tx) => {
          const cycleAnchor: HandlingCycleCreationAnchor = command.cycleAnchor ?? {
            sourceRevision: 1,
            openedReason:
              command.item.sourceType === 'review'
                ? 'review_observed'
                : 'feedback_submitted',
            actorType: command.item.sourceType === 'review' ? 'provider' : 'guest',
            triggerEventId: command.eventId,
            openedAt: command.item.createdAt,
          }
          const inserted = await insertItemIdempotent(tx, command.item, cycleAnchor)
          if (!inserted.created) {
            if (
              command.item.sourceType === 'feedback' &&
              cycleAnchor.openedReason === 'feedback_submitted'
            ) {
              const [headRow] = await tx
                .select()
                .from(inboxHandlingCycleHeads)
                .where(
                  and(
                    eq(inboxHandlingCycleHeads.inboxItemId, inserted.item.id),
                    eq(
                      inboxHandlingCycleHeads.organizationId,
                      inserted.item.organizationId,
                    ),
                    eq(inboxHandlingCycleHeads.sourceType, 'feedback'),
                    eq(inboxHandlingCycleHeads.sourceId, inserted.item.sourceId),
                  ),
                )
                .for('update')
                .limit(1)
              if (headRow && cycleAnchor.sourceRevision > headRow.currentSourceRevision) {
                const current = handlingCycleHeadFromRow(headRow)
                const decision = createNextHandlingCycle({
                  current,
                  sourceRevision: cycleAnchor.sourceRevision,
                  openedReason: 'feedback_submitted',
                  openedBy: null,
                  actorType: 'guest',
                  triggerEventId: command.eventId,
                  openedAt: cycleAnchor.openedAt,
                })
                if (decision.isErr()) throw decision.error
                const cycleFacts = await insertNextHandlingCycleDecision(
                  tx,
                  decision.value,
                  cycleAnchor.openedAt,
                )
                const [advanced] = await tx
                  .update(inboxHandlingCycleHeads)
                  .set({
                    currentCycleNumber: decision.value.head.currentCycleNumber,
                    currentSourceRevision: decision.value.head.currentSourceRevision,
                    stateRevision: decision.value.head.stateRevision,
                    status: 'open',
                    updatedAt: cycleAnchor.openedAt,
                  })
                  .where(
                    and(
                      eq(inboxHandlingCycleHeads.inboxItemId, inserted.item.id),
                      eq(inboxHandlingCycleHeads.stateRevision, current.stateRevision),
                      eq(
                        inboxHandlingCycleHeads.currentSourceRevision,
                        current.currentSourceRevision,
                      ),
                    ),
                  )
                  .returning({ id: inboxHandlingCycleHeads.inboxItemId })
                if (!advanced) {
                  throw inboxError(
                    'revision_conflict',
                    'Guest Handling Cycle changed during feedback submission',
                  )
                }
                await tx
                  .update(inboxItems)
                  .set({
                    status: 'open',
                    closedAt: null,
                    sourceDate: command.item.sourceDate,
                    commandRevision: sql<number>`${inboxItems.commandRevision} + 1`,
                    updatedAt: command.item.updatedAt,
                  })
                  .where(
                    and(
                      eq(inboxItems.id, inserted.item.id),
                      eq(inboxItems.organizationId, inserted.item.organizationId),
                      eq(inboxItems.sourceType, 'feedback'),
                      eq(inboxItems.sourceId, inserted.item.sourceId),
                    ),
                  )
                for (const fact of cycleFacts) await insertOutboxRow(tx, fact)
                await insertReceiptRow(
                  tx,
                  command.eventId,
                  command.consumerName,
                  'applied',
                )
                return {
                  outcome: 'applied' as const,
                  openingFacts: cycleFacts,
                  emitCreated: false,
                }
              }
            }
            await insertReceiptRow(tx, command.eventId, command.consumerName, 'duplicate')
            return 'duplicate' as const
          }
          await insertOutboxRow(tx, command.fact)
          for (const fact of inserted.openingFacts) await insertOutboxRow(tx, fact)
          await insertReceiptRow(tx, command.eventId, command.consumerName, 'applied')
          return {
            outcome: 'applied' as const,
            openingFacts: inserted.openingFacts,
            emitCreated: true,
          }
        })
        if (typeof outcome === 'string') return outcome
        if (outcome.emitCreated) await emitAfterCommit(events, command.fact)
        for (const fact of outcome.openingFacts) await emitAfterCommit(events, fact)
        return outcome.outcome
      })
    },

    applyReviewProjectionOnce: async (command) => {
      return trace('inbox.commandStore.applyReviewProjectionOnce', async () => {
        assertReviewProjectionCommand(command)
        const committed = await db.transaction(async (tx) => {
          if (!(await reserveReceiptRow(tx, command.eventId, command.consumerName))) {
            return {
              outcome: 'duplicate' as const,
              facts: [] as DomainEvent[],
            }
          }

          const active = command.projection.sourceContentState === 'active'
          const initialRevision = command.projection.revisions[0]
          const inserted = await insertItemIdempotent(tx, command.item, {
            sourceRevision: initialRevision.materialReviewRevision,
            openedReason: 'review_observed',
            actorType: 'provider',
            // Reconstructed source history is keyed by immutable revision,
            // not whichever independently delivered wake-up arrived first.
            triggerEventId: null,
            openedAt: initialRevision.observedAt,
            responseTarget: active ? projectionTargetAnchor(initialRevision) : null,
          })
          const facts: DomainEvent[] = []
          let projectedChange = inserted.created
          if (inserted.created) {
            await insertOutboxRow(tx, command.fact)
            facts.push(command.fact)
            for (const fact of inserted.openingFacts) {
              await insertOutboxRow(tx, fact)
              facts.push(fact)
            }
          }

          // Canonical lock order for an existing projection is head -> item.
          // For a just-inserted projection both rows are already ours, but the
          // same reads keep this path identical under an insert race.
          const [headRow] = await tx
            .select()
            .from(inboxHandlingCycleHeads)
            .where(
              and(
                eq(inboxHandlingCycleHeads.inboxItemId, inserted.item.id),
                eq(inboxHandlingCycleHeads.organizationId, inserted.item.organizationId),
                eq(inboxHandlingCycleHeads.sourceType, 'review'),
                eq(inboxHandlingCycleHeads.sourceId, inserted.item.sourceId),
              ),
            )
            .for('update')
            .limit(1)
          const [itemRow] = await tx
            .select()
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.id, inserted.item.id),
                eq(inboxItems.organizationId, inserted.item.organizationId),
                eq(inboxItems.propertyId, inserted.item.propertyId),
                eq(inboxItems.sourceType, 'review'),
                eq(inboxItems.sourceId, inserted.item.sourceId),
              ),
            )
            .for('update')
            .limit(1)
          if (!headRow || !itemRow) {
            throw inboxError(
              'not_found',
              'Review Inbox projection is waiting for its item and Handling Cycle',
            )
          }

          let current = handlingCycleHeadFromRow(headRow)
          if (
            current.currentSourceRevision >
            command.projection.currentMaterialReviewRevision
          ) {
            throw inboxError(
              'revision_conflict',
              'Inbox Review projection is ahead of Review authority',
            )
          }

          for (const revision of command.projection.revisions) {
            if (revision.materialReviewRevision <= current.currentSourceRevision) {
              continue
            }
            if (revision.materialReviewRevision !== current.currentSourceRevision + 1) {
              throw inboxError(
                'revision_conflict',
                'Inbox Review projection has a Material Revision gap',
              )
            }
            const decision = createNextHandlingCycle({
              current,
              sourceRevision: revision.materialReviewRevision,
              openedReason: 'material_revision_changed',
              openedBy: null,
              actorType: 'provider',
              triggerEventId: null,
              openedAt: revision.observedAt,
            })
            if (decision.isErr()) throw decision.error
            const cycleFacts = await insertNextHandlingCycleDecision(
              tx,
              decision.value,
              revision.observedAt,
              active ? projectionTargetAnchor(revision) : null,
            )
            const [advanced] = await tx
              .update(inboxHandlingCycleHeads)
              .set({
                currentCycleNumber: decision.value.head.currentCycleNumber,
                currentSourceRevision: decision.value.head.currentSourceRevision,
                currentMaterialReviewRevision: decision.value.head.currentSourceRevision,
                stateRevision: decision.value.head.stateRevision,
                status: 'open',
                updatedAt: revision.observedAt,
              })
              .where(
                and(
                  eq(inboxHandlingCycleHeads.inboxItemId, inserted.item.id),
                  eq(
                    inboxHandlingCycleHeads.organizationId,
                    inserted.item.organizationId,
                  ),
                  eq(inboxHandlingCycleHeads.stateRevision, current.stateRevision),
                  eq(
                    inboxHandlingCycleHeads.currentSourceRevision,
                    current.currentSourceRevision,
                  ),
                ),
              )
              .returning({ id: inboxHandlingCycleHeads.inboxItemId })
            if (!advanced) {
              throw inboxError(
                'revision_conflict',
                'Inbox Review projection changed during history catch-up',
              )
            }
            for (const fact of cycleFacts) {
              await insertOutboxRow(tx, fact)
              facts.push(fact)
            }
            projectedChange = true
            current = decision.value.head
          }

          const erasedAt = command.projection.sourceContentErasedAt
          if (!active && erasedAt instanceof Date && current.status === 'open') {
            await cancelResponseTargetForCycle(tx, {
              inboxItemId: current.inboxItemId,
              cycleNumber: current.currentCycleNumber,
              organizationId: current.organizationId,
              cancelledAt: erasedAt,
              reason: 'source_ineligible',
            })
            const closed = closeHandlingCycle({
              current,
              closeReason: 'source_ineligible',
              actorType: 'provider',
              actorUserId: null,
              triggerEventId: null,
              closedAt: erasedAt,
            })
            if (closed.isErr()) throw closed.error
            await tx
              .insert(inboxHandlingCycleTransitions)
              .values(transitionInsert(closed.value.transition, erasedAt))
            const [closedHead] = await tx
              .update(inboxHandlingCycleHeads)
              .set({
                stateRevision: closed.value.head.stateRevision,
                status: 'closed',
                updatedAt: erasedAt,
              })
              .where(
                and(
                  eq(inboxHandlingCycleHeads.inboxItemId, inserted.item.id),
                  eq(
                    inboxHandlingCycleHeads.organizationId,
                    inserted.item.organizationId,
                  ),
                  eq(inboxHandlingCycleHeads.stateRevision, current.stateRevision),
                  eq(inboxHandlingCycleHeads.status, 'open'),
                ),
              )
              .returning({ id: inboxHandlingCycleHeads.inboxItemId })
            if (!closedHead) {
              throw inboxError(
                'revision_conflict',
                'Inbox Review projection changed during inactive-source close',
              )
            }
            const cycleFact = lifecycleFactFor(closed.value.transition)
            await insertOutboxRow(tx, cycleFact)
            facts.push(cycleFact)
            projectedChange = true
            current = closed.value.head
          }

          if (!active && itemRow.status === 'open' && erasedAt instanceof Date) {
            const statusFact = inboxItemStatusChanged({
              inboxItemId: inserted.item.id,
              organizationId: inserted.item.organizationId,
              propertyId: inserted.item.propertyId,
              oldStatus: 'open',
              newStatus: 'closed',
              occurredAt: erasedAt,
            })
            await insertOutboxRow(tx, statusFact)
            facts.push(statusFact)
          }

          const finalStatus = current.status
          const [updatedItem] = await tx
            .update(inboxItems)
            .set({
              sourceDate: command.projection.sourceDate,
              platform: command.projection.platform,
              rating: null,
              snippet: null,
              reviewerName: null,
              status: finalStatus,
              closedAt:
                finalStatus === 'closed' ? (active ? itemRow.closedAt : erasedAt) : null,
              commandRevision: sql<number>`LEAST(
                ${inboxItems.commandRevision} + 1,
                '9007199254740991'::bigint
              )`,
              updatedAt: command.now,
            })
            .where(
              and(
                eq(inboxItems.id, inserted.item.id),
                eq(inboxItems.organizationId, inserted.item.organizationId),
                eq(inboxItems.propertyId, inserted.item.propertyId),
                eq(inboxItems.sourceType, 'review'),
                eq(inboxItems.sourceId, inserted.item.sourceId),
              ),
            )
            .returning({ id: inboxItems.id })
          if (!updatedItem) {
            throw inboxError(
              'not_found',
              'Review Inbox item vanished during projection convergence',
            )
          }
          const outcome =
            command.eventKind === 'created' && !projectedChange
              ? ('duplicate' as const)
              : ('applied' as const)
          if (outcome === 'duplicate') {
            await tx
              .update(eventConsumerReceipts)
              .set({ status: 'duplicate' })
              .where(
                and(
                  eq(eventConsumerReceipts.eventId, command.eventId),
                  eq(eventConsumerReceipts.consumerName, command.consumerName),
                ),
              )
          }
          return { outcome, facts }
        })
        for (const fact of committed.facts) await emitAfterCommit(events, fact)
        return committed.outcome
      })
    },

    applySourceWithdrawnOnce: async (command) => {
      return trace('inbox.commandStore.applySourceWithdrawnOnce', async () => {
        if (
          command.fact.inboxItemId !== command.item.id ||
          command.fact.organizationId !== command.item.organizationId ||
          command.fact.propertyId !== command.item.propertyId ||
          command.fact.oldStatus !== 'open' ||
          command.fact.newStatus !== 'closed' ||
          command.fact.occurredAt.getTime() !== command.now.getTime()
        ) {
          throw inboxError(
            'invalid_input',
            'Source withdrawal fact does not match the Inbox command',
          )
        }
        const committed = await db.transaction(async (tx) => {
          if (!(await reserveReceiptRow(tx, command.eventId, command.consumerName))) {
            return { outcome: 'applied' as const, facts: [] as DomainEvent[] }
          }
          const [headRow] = await tx
            .select()
            .from(inboxHandlingCycleHeads)
            .where(
              and(
                eq(inboxHandlingCycleHeads.inboxItemId, command.item.id),
                eq(inboxHandlingCycleHeads.organizationId, command.item.organizationId),
                eq(inboxHandlingCycleHeads.sourceType, command.item.sourceType),
                eq(inboxHandlingCycleHeads.sourceId, command.item.sourceId),
              ),
            )
            .for('update')
            .limit(1)
          if (!headRow) {
            return { outcome: 'obsolete' as const, facts: [] as DomainEvent[] }
          }
          const current = handlingCycleHeadFromRow(headRow)
          if (
            command.sourceRevision !== undefined &&
            current.currentSourceRevision !== command.sourceRevision
          ) {
            await tx
              .update(eventConsumerReceipts)
              .set({ status: 'obsolete' })
              .where(
                and(
                  eq(eventConsumerReceipts.eventId, command.eventId),
                  eq(eventConsumerReceipts.consumerName, command.consumerName),
                ),
              )
            return { outcome: 'obsolete' as const, facts: [] as DomainEvent[] }
          }
          if (current.status === 'closed') {
            return { outcome: 'applied' as const, facts: [] as DomainEvent[] }
          }
          const decision = closeHandlingCycle({
            current,
            closeReason: 'guest_withdrawn',
            actorType: 'guest',
            actorUserId: null,
            triggerEventId: command.eventId,
            closedAt: command.now,
          })
          if (decision.isErr()) throw decision.error
          if (current.sourceType === 'feedback') {
            await cancelPrivateFeedbackTarget(tx, current, command.now)
          }
          const lifecycleFact = lifecycleFactFor(decision.value.transition)
          await tx
            .insert(inboxHandlingCycleTransitions)
            .values(transitionInsert(decision.value.transition, command.now))
          const [updatedHead] = await tx
            .update(inboxHandlingCycleHeads)
            .set({
              stateRevision: decision.value.head.stateRevision,
              status: 'closed',
              updatedAt: command.now,
            })
            .where(
              and(
                eq(inboxHandlingCycleHeads.inboxItemId, command.item.id),
                eq(inboxHandlingCycleHeads.organizationId, command.item.organizationId),
                eq(inboxHandlingCycleHeads.stateRevision, current.stateRevision),
                eq(inboxHandlingCycleHeads.status, 'open'),
              ),
            )
            .returning({ id: inboxHandlingCycleHeads.inboxItemId })
          if (!updatedHead) {
            throw inboxError(
              'revision_conflict',
              'Handling Cycle changed during withdrawal',
            )
          }
          const [updatedItem] = await tx
            .update(inboxItems)
            .set({
              status: 'closed',
              closedAt: command.now,
              commandRevision: sql<number>`${inboxItems.commandRevision} + 1`,
              updatedAt: command.now,
            })
            .where(
              and(
                eq(inboxItems.id, command.item.id),
                eq(inboxItems.organizationId, command.item.organizationId),
                eq(inboxItems.sourceType, command.item.sourceType),
                eq(inboxItems.sourceId, command.item.sourceId),
              ),
            )
            .returning({ id: inboxItems.id })
          if (!updatedItem) {
            throw inboxError('revision_conflict', 'Inbox item changed during withdrawal')
          }
          await insertOutboxRow(tx, command.fact)
          await insertOutboxRow(tx, lifecycleFact)
          return {
            outcome: 'applied' as const,
            facts: [command.fact, lifecycleFact] as DomainEvent[],
          }
        })
        for (const fact of committed.facts) await emitAfterCommit(events, fact)
        return committed.outcome
      })
    },

    applyReviewUpdatedOnce: async (command) => {
      return trace('inbox.commandStore.applyReviewUpdatedOnce', async () => {
        const facts = await db.transaction(async (tx) => {
          if (!(await reserveReceiptRow(tx, command.eventId, command.consumerName))) {
            return [] as DomainEvent[]
          }
          const [headRow] = await tx
            .select()
            .from(inboxHandlingCycleHeads)
            .where(
              and(
                eq(inboxHandlingCycleHeads.inboxItemId, command.item.id),
                eq(inboxHandlingCycleHeads.organizationId, command.item.organizationId),
                eq(inboxHandlingCycleHeads.sourceType, 'review'),
                eq(inboxHandlingCycleHeads.sourceId, command.item.sourceId),
              ),
            )
            .for('update')
            .limit(1)
          if (!headRow) {
            throw inboxError(
              'not_found',
              'Review update is waiting for its Inbox Handling Cycle',
            )
          }
          const current = handlingCycleHeadFromRow(headRow)
          const revision = command.materialReviewRevision ?? null
          let cycleFacts: ReadonlyArray<DomainEvent> = []
          if (revision !== null && revision > current.currentSourceRevision) {
            const decision = createNextHandlingCycle({
              current,
              sourceRevision: revision,
              openedReason: 'material_revision_changed',
              openedBy: null,
              actorType: 'provider',
              triggerEventId: command.eventId,
              openedAt: command.now,
            })
            if (decision.isErr()) throw decision.error
            cycleFacts = await insertNextHandlingCycleDecision(
              tx,
              decision.value,
              command.now,
              command.responseTarget,
            )
            const [advanced] = await tx
              .update(inboxHandlingCycleHeads)
              .set({
                currentCycleNumber: decision.value.head.currentCycleNumber,
                currentSourceRevision: decision.value.head.currentSourceRevision,
                currentMaterialReviewRevision: decision.value.head.currentSourceRevision,
                stateRevision: decision.value.head.stateRevision,
                status: 'open',
                updatedAt: command.now,
              })
              .where(
                and(
                  eq(inboxHandlingCycleHeads.inboxItemId, command.item.id),
                  eq(inboxHandlingCycleHeads.organizationId, command.item.organizationId),
                  eq(inboxHandlingCycleHeads.stateRevision, current.stateRevision),
                  eq(
                    inboxHandlingCycleHeads.currentSourceRevision,
                    current.currentSourceRevision,
                  ),
                ),
              )
              .returning({ id: inboxHandlingCycleHeads.inboxItemId })
            if (!advanced) {
              throw inboxError(
                'revision_conflict',
                'Review Handling Cycle changed during material update',
              )
            }
          }

          // Projection metadata and any newly actionable cycle co-commit with
          // the receipt. A stale/replayed revision cannot move the head back.
          await tx
            .update(inboxItems)
            .set({
              sourceDate: command.sourceDate,
              platform: command.platform,
              ...(cycleFacts.length > 0
                ? { status: 'open' as const, closedAt: null }
                : {}),
              commandRevision: sql<number>`${inboxItems.commandRevision} + 1`,
              updatedAt: command.now,
            })
            .where(
              and(
                eq(inboxItems.id, command.item.id),
                eq(inboxItems.organizationId, command.item.organizationId),
                eq(inboxItems.sourceType, 'review'),
                eq(inboxItems.sourceId, command.item.sourceId),
              ),
            )
          for (const fact of cycleFacts) await insertOutboxRow(tx, fact)
          return [...cycleFacts]
        })
        for (const fact of facts) await emitAfterCommit(events, fact)
        return 'applied' as const
      })
    },

    applyReviewSourceTransitionedOnce: async (command) => {
      return trace('inbox.commandStore.applyReviewSourceTransitionedOnce', async () => {
        const { closeFact, item } = command
        if (
          item.sourceType !== 'review' ||
          closeFact.inboxItemId !== item.id ||
          closeFact.organizationId !== item.organizationId ||
          closeFact.propertyId !== item.propertyId ||
          closeFact.oldStatus !== 'open' ||
          closeFact.newStatus !== 'closed' ||
          closeFact.occurredAt.getTime() !== command.transitionedAt.getTime()
        ) {
          throw inboxError(
            'invalid_input',
            'Review source transition fact does not match the Inbox item',
          )
        }

        const committedFacts = await db.transaction(async (tx) => {
          if (!(await reserveReceiptRow(tx, command.eventId, command.consumerName))) {
            return [] as DomainEvent[]
          }

          const [headRow] = await tx
            .select()
            .from(inboxHandlingCycleHeads)
            .where(
              and(
                eq(inboxHandlingCycleHeads.inboxItemId, item.id),
                eq(inboxHandlingCycleHeads.organizationId, item.organizationId),
                eq(inboxHandlingCycleHeads.sourceType, 'review'),
                eq(inboxHandlingCycleHeads.sourceId, item.sourceId),
              ),
            )
            .for('update')
            .limit(1)
          if (command.closeIfOpen && !headRow) {
            throw inboxError(
              'not_found',
              'Review source transition is waiting for its Handling Cycle',
            )
          }

          const [current] = await tx
            .select()
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.id, item.id),
                eq(inboxItems.organizationId, item.organizationId),
                eq(inboxItems.propertyId, item.propertyId),
                eq(inboxItems.sourceType, 'review'),
                eq(inboxItems.sourceId, item.sourceId),
              ),
            )
            .for('update')
            .limit(1)
          if (!current) return [] as DomainEvent[]

          const shouldCloseItem = command.closeIfOpen && current.status === 'open'
          const shouldCloseCycle = command.closeIfOpen && headRow?.status === 'open'
          const needsScrub =
            current.rating !== null ||
            current.snippet !== null ||
            current.reviewerName !== null
          if (!shouldCloseItem && !shouldCloseCycle && !needsScrub) {
            return [] as DomainEvent[]
          }

          let cycleFact: DomainEvent | null = null
          if (shouldCloseCycle && headRow) {
            await cancelResponseTargetForCycle(tx, {
              inboxItemId: handlingCycleHeadFromRow(headRow).inboxItemId,
              cycleNumber: headRow.currentCycleNumber,
              organizationId: handlingCycleHeadFromRow(headRow).organizationId,
              cancelledAt: command.transitionedAt,
              reason: 'source_ineligible',
            })
            const cycleDecision = closeHandlingCycle({
              current: handlingCycleHeadFromRow(headRow),
              closeReason: command.closeReason ?? 'source_ineligible',
              actorType: 'provider',
              actorUserId: null,
              triggerEventId: command.eventId,
              closedAt: command.transitionedAt,
            })
            if (cycleDecision.isErr()) throw cycleDecision.error
            cycleFact = lifecycleFactFor(cycleDecision.value.transition)
            await tx
              .insert(inboxHandlingCycleTransitions)
              .values(
                transitionInsert(cycleDecision.value.transition, command.transitionedAt),
              )
            const [closedHead] = await tx
              .update(inboxHandlingCycleHeads)
              .set({
                stateRevision: cycleDecision.value.head.stateRevision,
                status: 'closed',
                updatedAt: command.transitionedAt,
              })
              .where(
                and(
                  eq(inboxHandlingCycleHeads.inboxItemId, item.id),
                  eq(inboxHandlingCycleHeads.organizationId, item.organizationId),
                  eq(inboxHandlingCycleHeads.stateRevision, headRow.stateRevision),
                  eq(inboxHandlingCycleHeads.status, 'open'),
                ),
              )
              .returning({ id: inboxHandlingCycleHeads.inboxItemId })
            if (!closedHead) {
              throw inboxError(
                'revision_conflict',
                'Review Handling Cycle changed during source transition',
              )
            }
          }

          const [updated] = await tx
            .update(inboxItems)
            .set({
              rating: null,
              snippet: null,
              reviewerName: null,
              ...(shouldCloseItem
                ? { status: 'closed' as const, closedAt: command.transitionedAt }
                : {}),
              // Source-content erasure must not be blocked by an already
              // exhausted human-command fence. At the maximum, human writes
              // already fail closed; retain that value while completing the
              // mandatory scrub/terminal close.
              commandRevision: sql<number>`LEAST(
                ${inboxItems.commandRevision} + 1,
                '9007199254740991'::bigint
              )`,
              updatedAt: command.transitionedAt,
            })
            .where(
              and(
                eq(inboxItems.id, current.id),
                eq(inboxItems.organizationId, current.organizationId),
                eq(inboxItems.sourceType, 'review'),
              ),
            )
            .returning({ id: inboxItems.id })
          if (!updated) {
            throw inboxError(
              'not_found',
              'Review Inbox item vanished during source transition',
            )
          }
          const facts: DomainEvent[] = []
          if (shouldCloseItem) facts.push(closeFact)
          if (cycleFact) facts.push(cycleFact)
          for (const fact of facts) await insertOutboxRow(tx, fact)
          return facts
        })

        for (const fact of committedFacts) await emitAfterCommit(events, fact)
        return 'applied' as const
      })
    },

    applyReplyPublishedOnce: async (command) => {
      return trace('inbox.commandStore.applyReplyPublishedOnce', async () => {
        await db.transaction(async (tx) => {
          await insertReceiptRow(tx, command.eventId, command.consumerName, 'applied')
        })
        return 'applied' as const
      })
    },

    applyReplyObservedOnce: async (command) => {
      return trace('inbox.commandStore.applyReplyObservedOnce', async () => {
        const outcome = await db.transaction(async (tx) => {
          if (!(await reserveReceiptRow(tx, command.eventId, command.consumerName))) {
            return { status: 'applied' as const, facts: [] as DomainEvent[] }
          }

          const observation = command.currentObservation
          if (
            observation.authority !== 'review.current-google-reply-observation.v1' ||
            observation.organizationId !== command.item.organizationId ||
            observation.propertyId !== command.item.propertyId ||
            observation.reviewId !== command.item.sourceId
          ) {
            throw inboxError(
              'invalid_input',
              'Review observation permit does not match the Inbox item',
            )
          }

          // Canonical Review Handling Cycle lock order is head -> Inbox item.
          // `startNext` uses the same order; reversing it here lets a material
          // revision/reopen race form a PostgreSQL row-lock cycle.
          const headRows = await tx
            .select()
            .from(inboxHandlingCycleHeads)
            .where(
              and(
                eq(inboxHandlingCycleHeads.inboxItemId, command.item.id),
                eq(inboxHandlingCycleHeads.organizationId, command.item.organizationId),
                eq(inboxHandlingCycleHeads.sourceType, 'review'),
                eq(inboxHandlingCycleHeads.sourceId, observation.reviewId),
              ),
            )
            .for('update')
            .limit(1)
          const itemRows = await tx
            .select()
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.id, command.item.id),
                eq(inboxItems.organizationId, command.item.organizationId),
                eq(inboxItems.propertyId, observation.propertyId),
                eq(inboxItems.sourceType, 'review'),
                eq(inboxItems.sourceId, observation.reviewId),
              ),
            )
            .for('update')
            .limit(1)
          const headRow = headRows[0]
          const itemRow = itemRows[0]
          if (!itemRow || !headRow) {
            throw inboxError(
              'not_found',
              'Review Inbox item or Handling Cycle head not found',
            )
          }
          if (
            itemRow.status !== headRow.status ||
            headRow.currentSourceRevision !== observation.materialReviewRevision
          ) {
            throw inboxError(
              'revision_conflict',
              'Review Inbox Handling Cycle is not current for this observation',
            )
          }

          const shouldClose =
            observation.state === 'live' &&
            (observation.resolution === 'confirmed_on_google' ||
              observation.resolution === 'external_current_live')
          const reopenReason =
            observation.reviewSourceContentState === 'active' &&
            observation.state === 'absent' &&
            observation.change === 'deleted' &&
            observation.resolution === 'absent'
              ? ('provider_reply_deleted' as const)
              : null

          if (shouldClose && itemRow.status === 'open') {
            await completeGoogleReviewTarget(
              tx,
              handlingCycleHeadFromRow(headRow),
              observation.observedAt,
            )
            const decision = closeHandlingCycle({
              current: handlingCycleHeadFromRow(headRow),
              closeReason:
                observation.resolution === 'confirmed_on_google'
                  ? 'confirmed_on_google'
                  : 'external_reply_observed',
              actorType: 'provider',
              actorUserId: null,
              triggerEventId: command.eventId,
              closedAt: observation.observedAt,
            })
            if (decision.isErr()) throw decision.error
            const cycleFact = lifecycleFactFor(decision.value.transition)
            await tx
              .insert(inboxHandlingCycleTransitions)
              .values(transitionInsert(decision.value.transition, observation.observedAt))
            const [updatedHead] = await tx
              .update(inboxHandlingCycleHeads)
              .set({
                status: 'closed',
                stateRevision: decision.value.head.stateRevision,
                updatedAt: observation.observedAt,
              })
              .where(
                and(
                  eq(inboxHandlingCycleHeads.inboxItemId, command.item.id),
                  eq(inboxHandlingCycleHeads.stateRevision, headRow.stateRevision),
                  eq(inboxHandlingCycleHeads.status, 'open'),
                ),
              )
              .returning({ id: inboxHandlingCycleHeads.inboxItemId })
            if (!updatedHead) {
              throw inboxError(
                'revision_conflict',
                'Review Handling Cycle changed during reply close',
              )
            }
            const [updatedItem] = await tx
              .update(inboxItems)
              .set({
                status: 'closed',
                closedAt: observation.observedAt,
                ...(itemRow.firstReplyPublishedAt === null
                  ? { firstReplyPublishedAt: observation.observedAt }
                  : {}),
                commandRevision: sql<number>`${inboxItems.commandRevision} + 1`,
                updatedAt: observation.observedAt,
              })
              .where(
                and(
                  eq(inboxItems.id, command.item.id),
                  eq(inboxItems.organizationId, command.item.organizationId),
                  eq(inboxItems.status, 'open'),
                ),
              )
              .returning({ id: inboxItems.id })
            if (!updatedItem) {
              throw inboxError(
                'revision_conflict',
                'Inbox item changed during reply close',
              )
            }
            await insertOutboxRow(tx, command.closeFact)
            await insertOutboxRow(tx, cycleFact)
            return {
              status: 'applied' as const,
              facts: [command.closeFact, cycleFact] as DomainEvent[],
            }
          }

          if (reopenReason !== null && itemRow.status === 'closed') {
            const decision = createNextHandlingCycle({
              current: handlingCycleHeadFromRow(headRow),
              sourceRevision: observation.materialReviewRevision,
              openedReason: reopenReason,
              openedBy: null,
              actorType: 'provider',
              triggerEventId: command.eventId,
              openedAt: observation.observedAt,
            })
            if (decision.isErr()) throw decision.error
            const cycleFacts = await insertNextHandlingCycleDecision(
              tx,
              decision.value,
              observation.observedAt,
              {
                reviewAuthority: {
                  authority: 'review.current-response-target.v1',
                  organizationId: observation.organizationId,
                  propertyId: observation.propertyId,
                  reviewId: observation.reviewId,
                  sourceEpoch: observation.sourceEpoch,
                  materialReviewRevision: observation.materialReviewRevision,
                  eligibility: observation.responseTargetEligibility,
                  responseTargetStartAt: observation.responseTargetStartAt,
                },
                targetStart: {
                  basis: 'operational_reopen',
                  at: observation.observedAt,
                },
              },
            )
            const [updatedHead] = await tx
              .update(inboxHandlingCycleHeads)
              .set({
                currentCycleNumber: decision.value.head.currentCycleNumber,
                currentSourceRevision: decision.value.head.currentSourceRevision,
                currentMaterialReviewRevision: decision.value.head.currentSourceRevision,
                stateRevision: decision.value.head.stateRevision,
                status: 'open',
                updatedAt: observation.observedAt,
              })
              .where(
                and(
                  eq(inboxHandlingCycleHeads.inboxItemId, command.item.id),
                  eq(inboxHandlingCycleHeads.stateRevision, headRow.stateRevision),
                  eq(inboxHandlingCycleHeads.status, 'closed'),
                ),
              )
              .returning({ id: inboxHandlingCycleHeads.inboxItemId })
            if (!updatedHead) {
              throw inboxError(
                'revision_conflict',
                'Review Handling Cycle changed during provider reopen',
              )
            }
            const [updatedItem] = await tx
              .update(inboxItems)
              .set({
                status: 'open',
                closedAt: null,
                commandRevision: sql<number>`${inboxItems.commandRevision} + 1`,
                updatedAt: observation.observedAt,
              })
              .where(
                and(
                  eq(inboxItems.id, command.item.id),
                  eq(inboxItems.organizationId, command.item.organizationId),
                  eq(inboxItems.status, 'closed'),
                ),
              )
              .returning({ id: inboxItems.id })
            if (!updatedItem) {
              throw inboxError(
                'revision_conflict',
                'Inbox item changed during provider reopen',
              )
            }
            await insertOutboxRow(tx, command.reopenFact)
            for (const fact of cycleFacts) await insertOutboxRow(tx, fact)
            return {
              status: 'applied' as const,
              facts: [command.reopenFact, ...cycleFacts] as DomainEvent[],
            }
          }

          return { status: 'applied' as const, facts: [] as DomainEvent[] }
        })
        for (const fact of outcome.facts) await emitAfterCommit(events, fact)
        return outcome.status
      })
    },

    recordReceipt: async (eventId, consumerName, status) => {
      return trace('inbox.commandStore.recordReceipt', async () => {
        await db.transaction(async (tx) => {
          await insertReceiptRow(tx, eventId, consumerName, status)
        })
      })
    },
  }
}
