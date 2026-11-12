import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  inboxHandlingCycleHeads,
  inboxHandlingCycleTransitions,
  inboxHandlingCycles,
} from '#/shared/db/schema/inbox.schema'
import type { Tx } from '#/shared/outbox/commit'
import {
  inboxItemId,
  feedbackId,
  organizationId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { ReviewHandlingCycleStore } from '../application/ports/review-handling-cycle.store'
import type {
  HandlingCycle,
  HandlingCycleActorType,
  HandlingCycleHead,
  HandlingCycleOpenReason,
  HandlingCycleTransition,
  InboxItem,
  ReviewHandlingCycleHead,
} from '../domain/types'
import {
  createInitialHandlingCycle,
  type HandlingCycleDecision,
} from '../domain/handling-cycles'
import { inboxError } from '../domain/errors'
import {
  assertReviewResponseTargetAuthorityMatchesCycle,
  insertResponseTargetForHandlingCycle,
} from './response-target.store'
import type { ReviewCycleTargetAnchor } from '../application/ports/review-response-target-authority.port'

type HeadRow = typeof inboxHandlingCycleHeads.$inferSelect

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
  findHead: async (itemId, orgId, tx) => {
    return trace('inbox.handlingCycle.findHead', async () => {
      const rows = await (tx ?? db)
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
})
