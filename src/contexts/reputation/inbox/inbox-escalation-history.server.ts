// Escalation history for the atomic inbox command store (ADR 0055).
// Split out of inbox-command-store.ts: every write
// here targets `inbox_escalation_history`, never `inbox_items`, so none of it
// is subject to inbox-status-mirror.guard.test.ts's mirror-writer fence.
// inbox-command-store.ts imports from this module; this module must never
// import back from it (that would be a circular dependency).

import { and, eq } from 'drizzle-orm'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import { inboxEscalationHistory } from '#/shared/db/schema/inbox-triage-history.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { InboxItem } from '../domain/inbox-types'

type InboxEscalationHistoryKind = 'escalated' | 'resolved'

/**
 * Resolve the source Handling Cycle that owns a human assignment or
 * escalation decision.
 *
 * This read intentionally happens before the Inbox item compare-and-swap and
 * does not lock the row. If a cycle command commits first, the item revision CAS rejects this command;
 * if this command wins the item row, the cycle observed here is the cycle in
 * which the decision occurred.
 */
export async function readCurrentCycleNumber(
  tx: Tx,
  item: InboxItem,
): Promise<number | null> {
  const rows = await tx
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
  const cycleNumber = rows[0]?.currentCycleNumber
  return typeof cycleNumber === 'number' &&
    Number.isSafeInteger(cycleNumber) &&
    cycleNumber >= 1
    ? cycleNumber
    : null
}

/**
 * Append one escalation decision keyed by the command revision it produced.
 *
 * `handlingCycleNumber` is read after the item compare-and-swap has taken the
 * row lock, so the cycle recorded here is the cycle the decision landed in.
 * It stays nullable: an item whose Handling Cycle head is still awaiting
 * repair must still be able to record that it was escalated.
 */
export async function appendEscalationHistory(
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
