import { inboxAssignmentHistory } from '#/shared/db/schema/inbox.schema'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { inboxError } from '../domain/inbox-errors'
import type { InboxItemAssigned, InboxItemUnassigned } from '../domain/inbox-events'
import type { InboxItem } from '../domain/inbox-types'
import { and, eq } from 'drizzle-orm'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import { validCycleNumber } from './inbox-command-guards.server'

/** The CAS result, never the caller's clock or proposed revision, orders assignments. */
export async function insertAssignmentFact(
  tx: Tx,
  event: InboxItemAssigned | InboxItemUnassigned,
  commandRevision: number,
): Promise<void> {
  await insertOutboxRow(tx, { ...event, commandRevision })
}

export async function currentAssignmentCycleNumber(
  tx: Tx,
  item: InboxItem,
): Promise<number | null> {
  // Read before the item compare-and-swap, without a lock: if a cycle command
  // commits first the revision CAS rejects this command; if this command wins
  // the row, the cycle observed here is the cycle the decision occurred in.
  const [row] = await tx
    .select({ currentCycleNumber: inboxItems.currentCycleNumber })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.id, item.id),
        eq(inboxItems.organizationId, item.organizationId),
        eq(inboxItems.propertyId, item.propertyId),
        eq(inboxItems.sourceType, item.sourceType),
        eq(inboxItems.sourceId, item.sourceId),
      ),
    )
    .limit(1)
  const cycleNumber = validCycleNumber(row?.currentCycleNumber ?? null)
  if (cycleNumber === null) {
    throw inboxError(
      'not_found',
      'Inbox item has no current Handling Cycle for assignment',
    )
  }
  return cycleNumber
}

/** One assignment-history row; the item names the scope, the rest is the change. */
export async function appendAssignmentHistory(
  tx: Tx,
  item: Readonly<{ id: string; organizationId: string; propertyId: string }>,
  change: Omit<
    typeof inboxAssignmentHistory.$inferInsert,
    'inboxItemId' | 'organizationId' | 'propertyId'
  >,
): Promise<void> {
  await tx.insert(inboxAssignmentHistory).values({
    inboxItemId: item.id,
    organizationId: item.organizationId,
    propertyId: item.propertyId,
    ...change,
  })
}
