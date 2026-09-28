import { and, eq, sql } from 'drizzle-orm'
import { inboxHandlingCycleHeads } from '#/shared/db/schema/inbox.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { HandlingCycleHead, InboxItem } from '../domain/types'
import type { PersistedHead } from './inbox-command-guards'

/**
 * Move a Review Handling Cycle head across a Review-attested source-epoch
 * carry: `carriedFrom + 1` only re-bound `carriedFrom`'s unchanged material to
 * a newer epoch after Archive/Restore, a Google relink or a reconnect. Only the
 * exact-material fence moves; the cycle, its state revision and status stay,
 * because no guest change created work. Both the reply-observation and the
 * source-event projection paths collapse a carry here, under the head lock the
 * caller already holds, so a concurrent change fails the compare-and-swap and
 * surfaces as null instead of being overwritten.
 */
export async function advanceHeadAcrossSourceEpochCarry(
  tx: Tx,
  input: Readonly<{
    item: Pick<InboxItem, 'id' | 'organizationId' | 'propertyId' | 'sourceId'>
    head: Pick<HandlingCycleHead, 'currentCycleNumber' | 'stateRevision' | 'status'>
    carriedFrom: number
    observedAt: Date
  }>,
): Promise<PersistedHead | null> {
  const { item, head, carriedFrom, observedAt } = input
  const [carried] = await tx
    .update(inboxHandlingCycleHeads)
    .set({
      currentSourceRevision: carriedFrom + 1,
      currentMaterialReviewRevision: carriedFrom + 1,
      updatedAt: sql<Date>`GREATEST(${inboxHandlingCycleHeads.updatedAt}, ${observedAt})`,
    })
    .where(
      and(
        eq(inboxHandlingCycleHeads.inboxItemId, item.id),
        eq(inboxHandlingCycleHeads.organizationId, item.organizationId),
        eq(inboxHandlingCycleHeads.propertyId, item.propertyId),
        eq(inboxHandlingCycleHeads.sourceType, 'review'),
        eq(inboxHandlingCycleHeads.sourceId, item.sourceId),
        eq(inboxHandlingCycleHeads.currentCycleNumber, head.currentCycleNumber),
        eq(inboxHandlingCycleHeads.currentSourceRevision, carriedFrom),
        eq(inboxHandlingCycleHeads.currentMaterialReviewRevision, carriedFrom),
        eq(inboxHandlingCycleHeads.stateRevision, head.stateRevision),
        eq(inboxHandlingCycleHeads.status, head.status),
      ),
    )
    .returning()
  return carried ?? null
}
