import { and, eq, sql } from 'drizzle-orm'
import {
  inboxHandlingCycleHeads,
  inboxHandlingCycleTransitions,
  inboxHandlingCycles,
  inboxItems,
} from '#/shared/db/schema/inbox.schema'
import type { DomainEvent } from '#/shared/events/events'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import type { HandlingCycleHead, InboxItem } from '../domain/types'
import { inboxError } from '../domain/errors'
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
  ApplyReplyObservedCommand,
  ApplyReviewSourceTransitionedCommand,
  ApplySourceCreatedCommand,
  HandlingCycleCreationAnchor,
  ReviewCycleCreationAnchor,
} from '../application/ports/inbox-command-store.port'
import type { CurrentReplyObservationPermit } from '../application/ports/reply-observation-authority.port'
import type { CurrentReviewInboxProjectionPermit } from '../application/ports/review-response-target-authority.port'
import {
  cancelResponseTargetForCycle,
  insertResponseTargetForHandlingCycle,
} from './response-target.store'
import {
  handlingCycleHeadFromRow,
  itemFromRow,
  lifecycleFactFor,
  normalizeCreationAnchor,
  projectionTargetAnchor,
  type LifecycleFactMarks,
  type PersistedHead,
  type PersistedItem,
} from './inbox-command-guards'
import { advanceHeadAcrossSourceEpochCarry } from './review-epoch-carry-head'
import { closeReviewCycleOnGoogleReply } from './review-reply-close'

import { inboxItemToInsertRow } from './mappers/inbox.mapper'
import { assertManualReopenPermitted } from '../domain/handling-outcome-authority'
import { selectSourceUnavailableCloseReasons } from './handling-cycle-transitions.read'

/**
 * A withdrawn, purged or ineligible private-feedback source can never be
 * handled, so it cannot be reopened either. Runs inside the same locked
 * transaction as the reopen so a withdrawal committing concurrently cannot
 * slip past it; reads the whole item history like the outcome check does.
 */
export async function assertManualReopenHonest(
  tx: Tx,
  head: HandlingCycleHead,
): Promise<void> {
  if (head.sourceType !== 'feedback') return
  const decision = assertManualReopenPermitted({
    current: head,
    recordedCloseReasons: await selectSourceUnavailableCloseReasons(tx, {
      inboxItemId: head.inboxItemId,
      organizationId: head.organizationId,
    }),
  })
  if (decision.isErr()) throw decision.error
}

export async function insertNextHandlingCycleDecision(
  tx: Tx,
  decision: HandlingCycleDecision,
  createdAt: Date,
  responseTarget?: HandlingCycleCreationAnchor['responseTarget'],
  marks: LifecycleFactMarks = {},
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
  return decision.transitions.map((transition) => lifecycleFactFor(transition, marks))
}

/**
 * Idempotent insert on the (sourceType, sourceId, organizationId) unique
 * anchor. Returns the inserted row, or the pre-existing row with
 * `created: false` after a re-select — never throws on the unique race.
 */
export async function insertItemIdempotent(
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
        openingFacts = decision.transitions.map((transition) =>
          lifecycleFactFor(transition),
        )
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
export async function tryUpdateItemRow(
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

/** Update one item under its command revision fence. */
export async function updateItemRow(
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

/** Canonical projection lock order: Handling Cycle head first, then the Inbox row. */
export async function lockReviewProjectionRows(
  tx: Tx,
  item: InboxItem,
): Promise<Readonly<{ headRow: PersistedHead; itemRow: PersistedItem }>> {
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
  const [itemRow] = await tx
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
  if (!headRow || !itemRow) {
    throw inboxError(
      'not_found',
      'Review Inbox projection is waiting for its item and Handling Cycle',
    )
  }
  return { headRow, itemRow }
}

/**
 * Replay every attested Material Revision the Inbox head has not reached yet,
 * opening one Handling Cycle per revision at that revision's own observation
 * instant; a revision Review attests as a source-epoch carry only moves the
 * head. A gap in the attested history is a conflict, never a silent skip.
 * `withItemCreation` marks the opened facts when this command also created the
 * item, so they are not mistaken for a change someone already saw.
 */
export async function catchUpProjectionRevisions(
  tx: Tx,
  input: Readonly<{
    item: InboxItem
    revisions: CurrentReviewInboxProjectionPermit['revisions']
    active: boolean
    current: HandlingCycleHead
    withItemCreation: boolean
  }>,
): Promise<Readonly<{ head: HandlingCycleHead; advanced: boolean }>> {
  let current = input.current
  let advanced = false
  for (const revision of input.revisions) {
    if (revision.materialReviewRevision <= current.currentSourceRevision) {
      continue
    }
    if (revision.materialReviewRevision !== current.currentSourceRevision + 1) {
      throw inboxError(
        'revision_conflict',
        'Inbox Review projection has a Material Revision gap',
      )
    }
    if (revision.sourceEpochCarry) {
      const carried = await advanceHeadAcrossSourceEpochCarry(tx, {
        item: input.item,
        head: current,
        carriedFrom: current.currentSourceRevision,
        observedAt: revision.observedAt,
      })
      if (!carried) {
        throw inboxError(
          'revision_conflict',
          'Inbox Review projection changed during source-epoch carry',
        )
      }
      advanced = true
      current = handlingCycleHeadFromRow(carried)
      continue
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
      input.active ? projectionTargetAnchor(revision) : null,
      { openedWithItem: input.withItemCreation },
    )
    const [advancedHead] = await tx
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
          eq(inboxHandlingCycleHeads.inboxItemId, input.item.id),
          eq(inboxHandlingCycleHeads.organizationId, input.item.organizationId),
          eq(inboxHandlingCycleHeads.stateRevision, current.stateRevision),
          eq(
            inboxHandlingCycleHeads.currentSourceRevision,
            current.currentSourceRevision,
          ),
        ),
      )
      .returning({ id: inboxHandlingCycleHeads.inboxItemId })
    if (!advancedHead) {
      throw inboxError(
        'revision_conflict',
        'Inbox Review projection changed during history catch-up',
      )
    }
    for (const fact of cycleFacts) await insertOutboxRow(tx, fact)
    advanced = true
    current = decision.value.head
  }
  return { head: current, advanced }
}

/**
 * A source Google erased cannot keep an open Response Target or an open cycle:
 * cancel the target and close the cycle at the erasure instant.
 */
export async function closeCycleForErasedSource(
  tx: Tx,
  input: Readonly<{ item: InboxItem; current: HandlingCycleHead; erasedAt: Date }>,
): Promise<HandlingCycleHead> {
  const { item, current, erasedAt } = input
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
        eq(inboxHandlingCycleHeads.inboxItemId, item.id),
        eq(inboxHandlingCycleHeads.organizationId, item.organizationId),
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
  const fact = lifecycleFactFor(closed.value.transition)
  await insertOutboxRow(tx, fact)
  return closed.value.head
}

/** Write the converged projection back onto the Inbox row under its own fence. */
export async function convergeProjectedItemRow(
  tx: Tx,
  input: Readonly<{
    item: InboxItem
    itemRow: PersistedItem
    projection: CurrentReviewInboxProjectionPermit
    finalStatus: HandlingCycleHead['status']
    active: boolean
    erasedAt: Date | null
    now: Date
  }>,
): Promise<void> {
  const { item, itemRow, projection, finalStatus, active, erasedAt } = input
  const closedAt =
    finalStatus === 'closed' ? (active ? itemRow.closedAt : erasedAt) : null
  // `commandRevision` is the manager's optimistic-concurrency token: the detail
  // pane reads it and submits it back with the next command, and a mismatch is
  // reported as "Inbox item changed; reload current state". Convergence runs on
  // every relay tick for the review, including ticks that project nothing new —
  // so an unconditional bump invalidated an idle manager's open page and made
  // ordinary interactions fail with `revision_conflict`. Advance the token only
  // when this write actually changes the projected row.
  const projectedRowChanged = sql`(
    ${inboxItems.sourceDate} IS DISTINCT FROM ${projection.sourceDate}
    OR ${inboxItems.platform} IS DISTINCT FROM ${projection.platform}
    OR ${inboxItems.status} IS DISTINCT FROM ${finalStatus}
    OR ${inboxItems.closedAt} IS DISTINCT FROM ${closedAt}
    OR ${inboxItems.rating} IS NOT NULL
    OR ${inboxItems.snippet} IS NOT NULL
    OR ${inboxItems.reviewerName} IS NOT NULL
  )`
  const [updatedItem] = await tx
    .update(inboxItems)
    .set({
      sourceDate: projection.sourceDate,
      platform: projection.platform,
      rating: null,
      snippet: null,
      reviewerName: null,
      status: finalStatus,
      closedAt,
      commandRevision: sql<number>`CASE
                WHEN ${projectedRowChanged}
                THEN LEAST(
                  ${inboxItems.commandRevision} + 1,
                  '9007199254740991'::bigint
                )
                ELSE ${inboxItems.commandRevision}
              END`,
      updatedAt: sql<Date>`CASE
                WHEN ${projectedRowChanged}
                THEN ${input.now}
                ELSE ${inboxItems.updatedAt}
              END`,
    })
    .where(
      and(
        eq(inboxItems.id, item.id),
        eq(inboxItems.organizationId, item.organizationId),
        eq(inboxItems.propertyId, item.propertyId),
        eq(inboxItems.sourceType, 'review'),
        eq(inboxItems.sourceId, item.sourceId),
      ),
    )
    .returning({ id: inboxItems.id })
  if (!updatedItem) {
    throw inboxError(
      'not_found',
      'Review Inbox item vanished during projection convergence',
    )
  }
}

/** The consumer's close: the shared close, then its status and cycle facts. */
export async function closeCycleOnObservedReply(
  tx: Tx,
  command: ApplyReplyObservedCommand,
  input: Readonly<{
    headRow: PersistedHead
    itemRow: PersistedItem
    observation: CurrentReplyObservationPermit
  }>,
): Promise<void> {
  const { cycleFact } = await closeReviewCycleOnGoogleReply(tx, {
    ...input,
    item: command.item,
    triggerEventId: command.eventId,
  })
  await insertOutboxRow(tx, command.closeFact)
  await insertOutboxRow(tx, cycleFact)
}

/**
 * The reply Google was showing is gone: open the next Handling Cycle and start
 * its Response Target from the observation instant, not the original source.
 */
export async function reopenCycleOnDeletedReply(
  tx: Tx,
  command: ApplyReplyObservedCommand,
  input: Readonly<{
    headRow: PersistedHead
    observation: CurrentReplyObservationPermit
    reopenReason: 'provider_reply_deleted'
  }>,
): Promise<void> {
  const { headRow, observation } = input
  const decision = createNextHandlingCycle({
    current: handlingCycleHeadFromRow(headRow),
    sourceRevision: observation.materialReviewRevision,
    openedReason: input.reopenReason,
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
        rating: observation.rating,
      },
      targetStart: { basis: 'operational_reopen', at: observation.observedAt },
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
    throw inboxError('revision_conflict', 'Inbox item changed during provider reopen')
  }
  await insertOutboxRow(tx, command.reopenFact)
  for (const fact of cycleFacts) await insertOutboxRow(tx, fact)
}

/**
 * A repeat Guest submission on an item that already exists is not a duplicate:
 * it opens the next Handling Cycle at the newer Guest revision and reopens the
 * Inbox row. Returns null when the stored head is already at or past it.
 */
export async function openNextFeedbackCycleOnResubmission(
  tx: Tx,
  command: ApplySourceCreatedCommand,
  cycleAnchor: HandlingCycleCreationAnchor,
  item: InboxItem,
): Promise<readonly DomainEvent[] | null> {
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
  if (!headRow || cycleAnchor.sourceRevision <= headRow.currentSourceRevision) {
    return null
  }
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
        eq(inboxHandlingCycleHeads.inboxItemId, item.id),
        eq(inboxHandlingCycleHeads.stateRevision, current.stateRevision),
        eq(inboxHandlingCycleHeads.currentSourceRevision, current.currentSourceRevision),
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
        eq(inboxItems.id, item.id),
        eq(inboxItems.organizationId, item.organizationId),
        eq(inboxItems.sourceType, 'feedback'),
        eq(inboxItems.sourceId, item.sourceId),
      ),
    )
  for (const fact of cycleFacts) await insertOutboxRow(tx, fact)
  return cycleFacts
}

/**
 * The Review source is no longer eligible: cancel its Response Target and close
 * the open Handling Cycle at the transition instant.
 */
export async function closeCycleForSourceTransition(
  tx: Tx,
  command: ApplyReviewSourceTransitionedCommand,
  headRow: PersistedHead,
): Promise<DomainEvent> {
  const { item, transitionedAt } = command
  const current = handlingCycleHeadFromRow(headRow)
  await cancelResponseTargetForCycle(tx, {
    inboxItemId: current.inboxItemId,
    cycleNumber: headRow.currentCycleNumber,
    organizationId: current.organizationId,
    cancelledAt: transitionedAt,
    reason: 'source_ineligible',
  })
  const cycleDecision = closeHandlingCycle({
    current: handlingCycleHeadFromRow(headRow),
    closeReason: command.closeReason ?? 'source_ineligible',
    actorType: 'provider',
    actorUserId: null,
    triggerEventId: command.eventId,
    closedAt: transitionedAt,
  })
  if (cycleDecision.isErr()) throw cycleDecision.error
  const cycleFact = lifecycleFactFor(cycleDecision.value.transition)
  await tx
    .insert(inboxHandlingCycleTransitions)
    .values(transitionInsert(cycleDecision.value.transition, transitionedAt))
  const [closedHead] = await tx
    .update(inboxHandlingCycleHeads)
    .set({
      stateRevision: cycleDecision.value.head.stateRevision,
      status: 'closed',
      updatedAt: transitionedAt,
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
  return cycleFact
}

/** Drop every provider-controlled copy, and close the row when the source transition closes work. */
export async function scrubTransitionedItemRow(
  tx: Tx,
  command: ApplyReviewSourceTransitionedCommand,
  current: PersistedItem,
  closeItem: boolean,
): Promise<void> {
  const [updated] = await tx
    .update(inboxItems)
    .set({
      rating: null,
      snippet: null,
      reviewerName: null,
      ...(closeItem
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
    throw inboxError('not_found', 'Review Inbox item vanished during source transition')
  }
}
