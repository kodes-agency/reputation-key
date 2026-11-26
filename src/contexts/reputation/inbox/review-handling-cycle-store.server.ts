import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  inboxHandlingCycleTransitions,
  inboxHandlingCycles,
  inboxItems,
} from '#/shared/db/schema/inbox.schema'
import type { Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import type { ReviewHandlingCycleStore } from './review-handling-cycle-store.port.server'
import type {
  HandlingCycle,
  HandlingCycleActorType,
  HandlingCycleOpenReason,
  HandlingCycleTransition,
  InboxItem,
} from '../domain/inbox-types'
import {
  createInitialHandlingCycle,
  type HandlingCycleDecision,
} from '../domain/handling-cycles'
import {
  assertReviewResponseTargetAuthorityMatchesCycle,
  insertResponseTargetForHandlingCycle,
} from '../response-targets/store.server'
import type { ReviewCycleTargetAnchor } from './review-cycle-target-anchor.server'
import { cycleHeadItemColumns, persistedHeadFromItemRow } from './inbox-cycle-head.server'

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
  await tx
    .update(inboxItems)
    .set(cycleHeadItemColumns(decision.value.head))
    .where(
      and(eq(inboxItems.id, item.id), eq(inboxItems.organizationId, item.organizationId)),
    )
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
  findHead: async (itemId, orgId, tx) => {
    return trace('inbox.handlingCycle.findHead', async () => {
      const rows = await (tx ?? db)
        .select()
        .from(inboxItems)
        .where(and(eq(inboxItems.id, itemId), eq(inboxItems.organizationId, orgId)))
        .limit(1)
      return rows[0] ? persistedHeadFromItemRow(rows[0]) : null
    })
  },
})
