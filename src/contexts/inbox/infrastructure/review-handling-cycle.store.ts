import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  inboxHandlingCycleHeads,
  inboxHandlingCycles,
  inboxItems,
} from '#/shared/db/schema/inbox.schema'
import { materialReviewRevisions, reviews } from '#/shared/db/schema/review.schema'
import type { Tx } from '#/shared/outbox/commit'
import {
  inboxItemId,
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
  InboxItem,
  ReviewHandlingCycle,
  ReviewHandlingCycleHead,
} from '../domain/types'
import {
  createInitialReviewHandlingCycle,
  createNextReviewHandlingCycle,
} from '../domain/handling-cycles'
import { inboxError } from '../domain/errors'

type CycleRow = typeof inboxHandlingCycles.$inferSelect
type HeadRow = typeof inboxHandlingCycleHeads.$inferSelect

const cycleFromRow = (row: CycleRow): ReviewHandlingCycle => ({
  inboxItemId: inboxItemId(row.inboxItemId),
  cycleNumber: row.cycleNumber,
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  reviewId: reviewId(row.reviewId),
  materialReviewRevision: row.materialReviewRevision,
  openedReason: row.openedReason as ReviewHandlingCycle['openedReason'],
  supersedesCycleNumber: row.supersedesCycleNumber,
  openedBy: row.openedBy ? userId(row.openedBy) : null,
  openedAt: row.openedAt,
})

const headFromRow = (row: HeadRow): ReviewHandlingCycleHead => ({
  inboxItemId: inboxItemId(row.inboxItemId),
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  reviewId: reviewId(row.reviewId),
  currentCycleNumber: row.currentCycleNumber,
  currentMaterialReviewRevision: row.currentMaterialReviewRevision,
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

/**
 * Seed cycle one in the caller's Inbox-item creation transaction. This helper
 * is intentionally exported only to the Inbox command store so item, opening
 * fact, and CAS head appear atomically.
 */
export async function insertInitialReviewHandlingCycle(
  tx: Tx,
  item: InboxItem,
  materialReviewRevision: number,
): Promise<void> {
  if (item.sourceType !== 'review') {
    throw inboxError('invalid_input', 'A Review Handling Cycle requires a Review item')
  }
  const decision = createInitialReviewHandlingCycle({
    inboxItemId: item.id,
    organizationId: item.organizationId,
    propertyId: item.propertyId,
    reviewId: reviewId(item.sourceId as string),
    materialReviewRevision,
    openedAt: item.createdAt,
    status: item.status,
  })
  if (decision.isErr()) throw decision.error

  await tx.insert(inboxHandlingCycles).values({
    ...decision.value.cycle,
    createdAt: item.createdAt,
  })
  await tx.insert(inboxHandlingCycleHeads).values({
    ...decision.value.head,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  })
}

async function assertMaterialRevisionExists(
  tx: Tx,
  current: ReviewHandlingCycleHead,
  materialReviewRevision: number,
): Promise<void> {
  const reviewRows = await tx
    .select({ sourceRevision: reviews.sourceRevision })
    .from(reviews)
    .where(
      and(
        eq(reviews.organizationId, current.organizationId),
        eq(reviews.propertyId, current.propertyId),
        eq(reviews.id, current.reviewId),
      ),
    )
    .limit(1)
  if (!reviewRows[0]) {
    throw inboxError('not_found', 'Review not found for Inbox Handling Cycle')
  }
  if (reviewRows[0].sourceRevision !== materialReviewRevision) {
    throw inboxError(
      'revision_conflict',
      'Review Material Revision changed; reload and retry',
      {
        requestedMaterialReviewRevision: materialReviewRevision,
        currentMaterialReviewRevision: reviewRows[0].sourceRevision,
      },
    )
  }
  const rows = await tx
    .select({ revision: materialReviewRevisions.revision })
    .from(materialReviewRevisions)
    .where(
      and(
        eq(materialReviewRevisions.organizationId, current.organizationId),
        eq(materialReviewRevisions.propertyId, current.propertyId),
        eq(materialReviewRevisions.reviewId, current.reviewId),
        eq(materialReviewRevisions.revision, materialReviewRevision),
      ),
    )
    .limit(1)
  if (!rows[0]) {
    throw inboxError('not_found', 'Material Review Revision not found for Inbox item', {
      inboxItemId: current.inboxItemId,
      materialReviewRevision,
    })
  }
}

export const createReviewHandlingCycleStore = (
  db: Database,
): ReviewHandlingCycleStore => ({
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
          openedBy: command.openedBy,
          openedAt: command.openedAt,
        })
        if (decision.isErr()) throw decision.error
        await assertMaterialRevisionExists(tx, current, command.materialReviewRevision)

        await tx.insert(inboxHandlingCycles).values({
          ...decision.value.cycle,
          createdAt: command.openedAt,
        })
        const updatedHeads = await tx
          .update(inboxHandlingCycleHeads)
          .set({
            currentCycleNumber: decision.value.head.currentCycleNumber,
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
          .set({ status: 'open', closedAt: null, updatedAt: command.openedAt })
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
