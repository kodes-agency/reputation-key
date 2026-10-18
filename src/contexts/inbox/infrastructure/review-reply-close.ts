// Inbox context — closing a Review Handling Cycle on a reply Google shows.
//
// Two writers close a Review cycle on Google's reply truth, both inside
// Review's exact-current observation permit: the `inbox.on-reply-observed`
// consumer, and the projection rebuild when it recreates a missing item whose
// review Google already answers. They share the lock order and the close here;
// only the consumer records facts and a receipt.

import { and, eq, sql } from 'drizzle-orm'
import {
  inboxHandlingCycleHeads,
  inboxHandlingCycleTransitions,
  inboxItems,
} from '#/shared/db/schema/inbox.schema'
import type { DomainEvent } from '#/shared/events/events'
import type { Tx } from '#/shared/outbox/commit'
import type { InboxItem } from '../domain/types'
import { inboxError } from '../domain/errors'
import { closeHandlingCycle } from '../domain/handling-cycles'
import { isAnsweringGoogleReply } from '../domain/rules'
import type {
  HandlingCycleCreationAnchor,
  ReviewCycleCreationAnchor,
} from '../application/ports/inbox-command-store.port'
import type { CurrentReplyObservationPermit } from '../application/ports/reply-observation-authority.port'
import { transitionInsert } from './review-handling-cycle.store'
import { completeGoogleReviewTarget } from './response-target.store'
import {
  assertObservationMatchesItem,
  handlingCycleHeadFromRow,
  itemFromRow,
  lifecycleFactFor,
  type PersistedHead,
  type PersistedItem,
} from './inbox-command-guards'
import { advanceHeadAcrossSourceEpochCarry } from './review-epoch-carry-head'

/**
 * Canonical Review Handling Cycle lock order is head -> Inbox item. `startNext`
 * uses the same order; reversing it here lets a material revision/reopen race
 * form a PostgreSQL row-lock cycle. A Review-attested epoch carry advances only
 * the head's exact-material fence under this lock; cycle, state, and status stay
 * unchanged because the normalized material did not create work.
 */
export async function lockReviewRowsForObservation(
  tx: Tx,
  item: InboxItem,
  observation: CurrentReplyObservationPermit,
): Promise<Readonly<{ headRow: PersistedHead; itemRow: PersistedItem }>> {
  const headRows = await tx
    .select()
    .from(inboxHandlingCycleHeads)
    .where(
      and(
        eq(inboxHandlingCycleHeads.inboxItemId, item.id),
        eq(inboxHandlingCycleHeads.organizationId, item.organizationId),
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
        eq(inboxItems.id, item.id),
        eq(inboxItems.organizationId, item.organizationId),
        eq(inboxItems.propertyId, observation.propertyId),
        eq(inboxItems.sourceType, 'review'),
        eq(inboxItems.sourceId, observation.reviewId),
      ),
    )
    .for('update')
    .limit(1)
  let headRow = headRows[0]
  const itemRow = itemRows[0]
  if (!itemRow || !headRow) {
    throw inboxError('not_found', 'Review Inbox item or Handling Cycle head not found')
  }
  if (itemRow.status !== headRow.status) {
    throw inboxError(
      'revision_conflict',
      'Review Inbox Handling Cycle is not current for this observation',
    )
  }

  if (headRow.currentSourceRevision !== observation.materialReviewRevision) {
    const carriedFrom = observation.sourceEpochCarryFromMaterialReviewRevision
    if (
      carriedFrom === null ||
      headRow.currentSourceRevision !== carriedFrom ||
      headRow.currentMaterialReviewRevision !== carriedFrom ||
      observation.materialReviewRevision !== carriedFrom + 1
    ) {
      throw inboxError(
        'revision_conflict',
        'Review Inbox Handling Cycle is not current for this observation',
      )
    }
    const carriedHead = await advanceHeadAcrossSourceEpochCarry(tx, {
      item,
      head: headRow,
      carriedFrom,
      observedAt: observation.observedAt,
    })
    if (!carriedHead) {
      throw inboxError(
        'revision_conflict',
        'Review Inbox Handling Cycle changed during source-epoch carry',
      )
    }
    headRow = carriedHead
  }
  return { headRow, itemRow }
}

/**
 * Google now shows the reply this cycle was working towards: complete the
 * Response Target, close the cycle, and close the Inbox row under the fences
 * the observation was read with. Returns the closed item and the cycle fact;
 * the caller decides whether to record it (`triggerEventId` is null for the
 * rebuild, which records no fact). The close is dated when Google was seen
 * answering; the rows are stamped `recordedAt`, by default the same instant.
 */
export async function closeReviewCycleOnGoogleReply(
  tx: Tx,
  input: Readonly<{
    item: InboxItem
    headRow: PersistedHead
    itemRow: PersistedItem
    observation: CurrentReplyObservationPermit
    triggerEventId: string | null
    recordedAt?: Date
  }>,
): Promise<Readonly<{ item: InboxItem; cycleFact: DomainEvent }>> {
  const { item, headRow, itemRow, observation } = input
  const recordedAt = input.recordedAt ?? observation.observedAt
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
    triggerEventId: input.triggerEventId,
    closedAt: observation.observedAt,
  })
  if (decision.isErr()) throw decision.error
  await tx
    .insert(inboxHandlingCycleTransitions)
    .values(transitionInsert(decision.value.transition, observation.observedAt))
  const [updatedHead] = await tx
    .update(inboxHandlingCycleHeads)
    .set({
      status: 'closed',
      stateRevision: decision.value.head.stateRevision,
      updatedAt: recordedAt,
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
      updatedAt: recordedAt,
    })
    .where(
      and(
        eq(inboxItems.id, item.id),
        eq(inboxItems.organizationId, item.organizationId),
        eq(inboxItems.status, 'open'),
      ),
    )
    .returning()
  if (!updatedItem) {
    throw inboxError('revision_conflict', 'Inbox item changed during reply close')
  }
  return {
    item: itemFromRow(updatedItem),
    cycleFact: lifecycleFactFor(decision.value.transition),
  }
}

/**
 * The rebuild may close the item it creates only on a permit for that exact
 * item showing a reply that answers the revision its first cycle opens on —
 * what `inbox.on-reply-observed` closes on. Anything else is a caller bug.
 */
function assertPermitAnswersNewItem(
  observation: CurrentReplyObservationPermit,
  item: InboxItem,
  anchor: ReviewCycleCreationAnchor,
): void {
  assertObservationMatchesItem(observation, item)
  if (
    item.sourceType !== 'review' ||
    !isAnsweringGoogleReply(observation) ||
    observation.materialReviewRevision !== anchor.materialReviewRevision
  ) {
    throw inboxError(
      'invalid_input',
      'Review observation permit does not answer the revision this item opens on',
    )
  }
}

type InsertItemIdempotent = (
  tx: Tx,
  item: InboxItem,
  anchor: HandlingCycleCreationAnchor,
) => Promise<Readonly<{ item: InboxItem; created: boolean }>>

/**
 * The rebuild's create for a review Google already answers, inside Review's
 * permit: insert the item and its first cycle, then close it as the consumer
 * would. The cycle opens no later than Google was seen answering, so Handling
 * History never shows the close before the open; the rows are stamped with
 * the repair's own time, never back-dated. An existing item is left alone.
 */
export async function insertReviewItemAnsweredOnGoogle(
  tx: Tx,
  input: Readonly<{
    item: InboxItem
    anchor: ReviewCycleCreationAnchor
    observation: CurrentReplyObservationPermit
    now: Date
  }>,
  insertItem: InsertItemIdempotent,
): Promise<Readonly<{ item: InboxItem; created: boolean }>> {
  const { anchor, observation, now } = input
  assertPermitAnswersNewItem(observation, input.item, anchor)
  const answeredAt = observation.observedAt
  const inserted = await insertItem(tx, input.item, {
    sourceRevision: anchor.materialReviewRevision,
    openedReason: 'review_observed',
    actorType: 'provider',
    triggerEventId: null,
    openedAt: answeredAt < now ? answeredAt : now,
  })
  if (!inserted.created) return inserted
  const rows = await lockReviewRowsForObservation(tx, inserted.item, observation)
  const closed = await closeReviewCycleOnGoogleReply(tx, {
    ...rows,
    item: inserted.item,
    observation,
    triggerEventId: null,
    recordedAt: answeredAt > now ? answeredAt : now,
  })
  return { item: closed.item, created: true }
}
