import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  inboxHandlingCycleHeads,
  inboxHandlingCycleTransitions,
  inboxHandlingCycles,
  inboxItems,
} from '#/shared/db/schema/inbox.schema'
import type { Tx } from '#/shared/outbox/commit'
import {
  inboxItemId,
  feedbackId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type {
  ReviewHandlingCycleStore,
  ReviewHandlingCycleExpectation,
} from '../application/ports/review-handling-cycle.store'
import type {
  HandlingCycle,
  HandlingCycleActorType,
  HandlingCycleHead,
  HandlingCycleOpenReason,
  HandlingCycleTransition,
  InboxItem,
  ReviewHandlingCycle,
  ReviewHandlingCycleHead,
} from '../domain/types'
import {
  createInitialHandlingCycle,
  createNextReviewHandlingCycle,
  type HandlingCycleDecision,
} from '../domain/handling-cycles'
import { inboxError } from '../domain/errors'
import {
  assertReviewResponseTargetAuthorityMatchesCycle,
  cancelResponseTargetForCycle,
  insertResponseTargetForHandlingCycle,
} from './response-target.store'
import type { ReviewCycleTargetAnchor } from '../application/ports/review-response-target-authority.port'

type CycleRow = typeof inboxHandlingCycles.$inferSelect
type HeadRow = typeof inboxHandlingCycleHeads.$inferSelect

const cycleFromRow = (row: CycleRow): ReviewHandlingCycle => {
  if (
    row.sourceType !== 'review' ||
    row.reviewId === null ||
    row.materialReviewRevision === null
  ) {
    throw inboxError('invalid_input', 'Stored Review Handling Cycle is invalid')
  }
  return {
    inboxItemId: inboxItemId(row.inboxItemId),
    cycleNumber: row.cycleNumber,
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.propertyId),
    sourceType: 'review',
    sourceId: reviewId(row.sourceId),
    sourceRevision: row.sourceRevision,
    reviewId: reviewId(row.reviewId),
    materialReviewRevision: row.materialReviewRevision,
    openedReason: row.openedReason as ReviewHandlingCycle['openedReason'],
    manualReopenReason:
      row.manualReopenReason as ReviewHandlingCycle['manualReopenReason'],
    manualReopenExplanation: row.manualReopenExplanation,
    supersedesCycleNumber: row.supersedesCycleNumber,
    openedBy: row.openedBy ? userId(row.openedBy) : null,
    openedAt: row.openedAt,
  }
}

const headFromRow = (row: HeadRow): ReviewHandlingCycleHead => {
  if (
    row.sourceType !== 'review' ||
    row.reviewId === null ||
    row.currentMaterialReviewRevision === null
  ) {
    throw inboxError('invalid_input', 'Stored Review Handling Cycle head is invalid')
  }
  return {
    inboxItemId: inboxItemId(row.inboxItemId),
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.propertyId),
    sourceType: 'review',
    sourceId: reviewId(row.sourceId),
    currentSourceRevision: row.currentSourceRevision,
    reviewId: reviewId(row.reviewId),
    currentCycleNumber: row.currentCycleNumber,
    currentMaterialReviewRevision: row.currentMaterialReviewRevision,
    stateRevision: row.stateRevision,
    status: row.status,
  }
}

const sourceHeadFromRow = (row: HeadRow): HandlingCycleHead => ({
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

const expectedMatches = (
  current: ReviewHandlingCycleHead,
  expected: ReviewHandlingCycleExpectation,
): boolean =>
  current.currentCycleNumber === expected.cycleNumber &&
  current.currentMaterialReviewRevision === expected.materialReviewRevision &&
  current.stateRevision === expected.stateRevision

const conflict = (
  current: ReviewHandlingCycleHead,
  expected: ReviewHandlingCycleExpectation,
) =>
  inboxError('revision_conflict', 'Inbox Handling Cycle changed; reload and retry', {
    expected,
    current: {
      cycleNumber: current.currentCycleNumber,
      materialReviewRevision: current.currentMaterialReviewRevision,
      stateRevision: current.stateRevision,
      status: current.status,
    },
  })

export type InitialHandlingCycleAnchor = Readonly<{
  sourceRevision: number
  openedReason: Extract<
    HandlingCycleOpenReason,
    'legacy_backfill' | 'review_observed' | 'feedback_submitted'
  >
  actorType: HandlingCycleActorType
  triggerEventId: string | null
  openedAt?: Date
  responseTarget?: ReviewCycleTargetAnchor | null
}>

export const cycleInsert = (cycle: HandlingCycle, createdAt: Date) => ({
  inboxItemId: cycle.inboxItemId,
  cycleNumber: cycle.cycleNumber,
  organizationId: cycle.organizationId,
  propertyId: cycle.propertyId,
  sourceType: cycle.sourceType,
  sourceId: cycle.sourceId,
  sourceRevision: cycle.sourceRevision,
  reviewId: cycle.sourceType === 'review' ? cycle.sourceId : null,
  materialReviewRevision: cycle.sourceType === 'review' ? cycle.sourceRevision : null,
  openedReason: cycle.openedReason,
  manualReopenReason: cycle.manualReopenReason,
  manualReopenExplanation: cycle.manualReopenExplanation,
  supersedesCycleNumber: cycle.supersedesCycleNumber,
  openedBy: cycle.openedBy,
  openedAt: cycle.openedAt,
  createdAt,
})

export const transitionInsert = (
  transition: HandlingCycleTransition,
  createdAt: Date,
) => ({
  ...transition,
  createdAt,
})

/** Seed any source cycle in the caller's item/source transaction. */
export async function insertInitialHandlingCycle(
  tx: Tx,
  item: InboxItem,
  anchor: InitialHandlingCycleAnchor,
): Promise<HandlingCycleDecision> {
  const decision = createInitialHandlingCycle({
    inboxItemId: item.id,
    organizationId: item.organizationId,
    propertyId: item.propertyId,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    sourceRevision: anchor.sourceRevision,
    openedReason: anchor.openedReason,
    actorType: anchor.actorType,
    triggerEventId: anchor.triggerEventId,
    openedAt: anchor.openedAt ?? item.createdAt,
    status: item.status,
  })
  if (decision.isErr()) throw decision.error

  const recordedAt = anchor.openedAt ?? item.createdAt
  if (anchor.responseTarget !== null) {
    assertReviewResponseTargetAuthorityMatchesCycle(
      decision.value.cycle,
      anchor.responseTarget,
    )
  }
  await tx
    .insert(inboxHandlingCycles)
    .values(cycleInsert(decision.value.cycle, recordedAt))
  if (anchor.responseTarget !== null) {
    await insertResponseTargetForHandlingCycle(
      tx,
      decision.value.cycle,
      recordedAt,
      anchor.responseTarget,
    )
  }
  await tx.insert(inboxHandlingCycleHeads).values({
    inboxItemId: decision.value.head.inboxItemId,
    organizationId: decision.value.head.organizationId,
    propertyId: decision.value.head.propertyId,
    sourceType: decision.value.head.sourceType,
    sourceId: decision.value.head.sourceId,
    currentSourceRevision: decision.value.head.currentSourceRevision,
    reviewId:
      decision.value.head.sourceType === 'review' ? decision.value.head.sourceId : null,
    currentMaterialReviewRevision:
      decision.value.head.sourceType === 'review'
        ? decision.value.head.currentSourceRevision
        : null,
    currentCycleNumber: decision.value.head.currentCycleNumber,
    stateRevision: decision.value.head.stateRevision,
    status: decision.value.head.status,
    createdAt: recordedAt,
    updatedAt: recordedAt,
  })
  await tx
    .insert(inboxHandlingCycleTransitions)
    .values(
      decision.value.transitions.map((transition) =>
        transitionInsert(transition, recordedAt),
      ),
    )
  return decision.value
}

export const createReviewHandlingCycleStore = (
  db: Database,
): ReviewHandlingCycleStore => ({
  findSourceHead: async (itemId, orgId) => {
    return trace('inbox.handlingCycle.findSourceHead', async () => {
      const rows = await db
        .select()
        .from(inboxHandlingCycleHeads)
        .where(
          and(
            eq(inboxHandlingCycleHeads.inboxItemId, itemId),
            eq(inboxHandlingCycleHeads.organizationId, orgId),
          ),
        )
        .limit(1)
      return rows[0] ? sourceHeadFromRow(rows[0]) : null
    })
  },
  findHead: async (itemId, orgId) => {
    return trace('inbox.handlingCycle.findHead', async () => {
      const rows = await db
        .select()
        .from(inboxHandlingCycleHeads)
        .where(
          and(
            eq(inboxHandlingCycleHeads.inboxItemId, itemId),
            eq(inboxHandlingCycleHeads.organizationId, orgId),
          ),
        )
        .limit(1)
      return rows[0] ? headFromRow(rows[0]) : null
    })
  },

  listCycles: async (itemId, orgId) => {
    return trace('inbox.handlingCycle.listCycles', async () => {
      const rows = await db
        .select()
        .from(inboxHandlingCycles)
        .where(
          and(
            eq(inboxHandlingCycles.inboxItemId, itemId),
            eq(inboxHandlingCycles.organizationId, orgId),
          ),
        )
        .orderBy(asc(inboxHandlingCycles.cycleNumber))
      return rows.map(cycleFromRow)
    })
  },

  startNext: async (command) => {
    return trace('inbox.handlingCycle.startNext', async () => {
      return db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(inboxHandlingCycleHeads)
          .where(
            and(
              eq(inboxHandlingCycleHeads.inboxItemId, command.inboxItemId),
              eq(inboxHandlingCycleHeads.organizationId, command.organizationId),
            ),
          )
          .for('update')
          .limit(1)
        if (!rows[0]) {
          throw inboxError('not_found', 'Inbox Handling Cycle head not found')
        }
        const current = headFromRow(rows[0])
        if (!expectedMatches(current, command.expected)) {
          throw conflict(current, command.expected)
        }

        const decision = createNextReviewHandlingCycle({
          current,
          materialReviewRevision: command.materialReviewRevision,
          openedReason: command.openedReason,
          manualReopenReason: command.manualReopenReason,
          manualReopenExplanation: command.manualReopenExplanation,
          openedBy: command.openedBy,
          openedAt: command.openedAt,
        })
        if (decision.isErr()) throw decision.error
        assertReviewResponseTargetAuthorityMatchesCycle(
          decision.value.cycle,
          command.responseTarget,
        )
        if (current.status === 'open') {
          await cancelResponseTargetForCycle(tx, {
            inboxItemId: current.inboxItemId,
            cycleNumber: current.currentCycleNumber,
            organizationId: current.organizationId,
            cancelledAt: command.openedAt,
            reason: 'superseded_by_source_revision',
          })
        }
        await tx
          .insert(inboxHandlingCycles)
          .values(cycleInsert(decision.value.cycle, command.openedAt))
        await tx
          .insert(inboxHandlingCycleTransitions)
          .values(
            decision.value.transitions.map((transition) =>
              transitionInsert(transition, command.openedAt),
            ),
          )
        await insertResponseTargetForHandlingCycle(
          tx,
          decision.value.cycle,
          command.openedAt,
          command.responseTarget,
        )
        const updatedHeads = await tx
          .update(inboxHandlingCycleHeads)
          .set({
            currentCycleNumber: decision.value.head.currentCycleNumber,
            currentSourceRevision: decision.value.head.currentSourceRevision,
            currentMaterialReviewRevision:
              decision.value.head.currentMaterialReviewRevision,
            stateRevision: decision.value.head.stateRevision,
            status: 'open',
            updatedAt: command.openedAt,
          })
          .where(
            and(
              eq(inboxHandlingCycleHeads.inboxItemId, command.inboxItemId),
              eq(inboxHandlingCycleHeads.organizationId, command.organizationId),
              eq(
                inboxHandlingCycleHeads.currentCycleNumber,
                command.expected.cycleNumber,
              ),
              eq(
                inboxHandlingCycleHeads.currentMaterialReviewRevision,
                command.expected.materialReviewRevision,
              ),
              eq(inboxHandlingCycleHeads.stateRevision, command.expected.stateRevision),
            ),
          )
          .returning({ inboxItemId: inboxHandlingCycleHeads.inboxItemId })
        if (!updatedHeads[0]) throw conflict(current, command.expected)

        const updatedItems = await tx
          .update(inboxItems)
          .set({
            status: 'open',
            closedAt: null,
            commandRevision: sql<number>`${inboxItems.commandRevision} + 1`,
            updatedAt: command.openedAt,
          })
          .where(
            and(
              eq(inboxItems.id, command.inboxItemId),
              eq(inboxItems.organizationId, command.organizationId),
              eq(inboxItems.sourceType, 'review'),
              eq(inboxItems.sourceId, current.reviewId),
            ),
          )
          .returning({ id: inboxItems.id })
        if (!updatedItems[0]) {
          throw inboxError('not_found', 'Review Inbox item not found for cycle head')
        }

        return decision.value
      })
    })
  },
})
