import { and, eq, sql } from 'drizzle-orm'
import { inboxHandlingCycleHeads, inboxItems } from '#/shared/db/schema/inbox.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { HandlingCycleHead, InboxItem } from '../../reputation/domain/inbox-types'
import {
  mirrorCycleHead,
  persistedHeadFromItemRow,
  type PersistedHead,
} from './inbox-cycle-head'

/**
 * Move a Review Handling Cycle head across a Review-attested source-epoch
 * carry: `carriedFrom + 1` only re-bound `carriedFrom`'s unchanged material to
 * a newer epoch after Archive/Restore, a Google relink or a reconnect. Only the
 * exact-material fence moves; the cycle, its state revision and status stay,
 * because no guest change created work. Both the reply-observation and the
 * source-event projection paths collapse a carry here, under the row lock the
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
    .update(inboxItems)
    .set({ currentSourceRevision: carriedFrom + 1 })
    .where(
      and(
        eq(inboxItems.id, item.id),
        eq(inboxItems.organizationId, item.organizationId),
        eq(inboxItems.propertyId, item.propertyId),
        eq(inboxItems.sourceType, 'review'),
        eq(inboxItems.sourceId, item.sourceId),
        eq(inboxItems.currentCycleNumber, head.currentCycleNumber),
        eq(inboxItems.currentSourceRevision, carriedFrom),
        eq(inboxItems.stateRevision, head.stateRevision),
      ),
    )
    .returning()
  const carriedFacts = carried ? persistedHeadFromItemRow(carried) : null
  if (!carriedFacts) return null
  // The caller's status stands: the Inbox row's own status may be converged
  // later in the same transaction.
  const carriedHead = { ...carriedFacts, status: head.status }
  await mirrorCycleHead(tx, {
    inboxItemId: item.id,
    organizationId: item.organizationId,
    sourceType: 'review',
    head: {
      currentCycleNumber: carriedHead.currentCycleNumber,
      currentSourceRevision: carriedHead.currentSourceRevision,
      stateRevision: carriedHead.stateRevision,
    },
    updatedAt: sql<Date>`GREATEST(${inboxHandlingCycleHeads.updatedAt}, ${observedAt})`,
  })
  return carriedHead
}
