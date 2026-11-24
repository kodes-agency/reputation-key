// Escalation history for the atomic inbox command store (ADR 0055).
// Split out of inbox-command-store.ts: every write
// here targets `inbox_escalation_history`, never `inbox_items`, so none of it
// is subject to inbox-status-mirror.guard.test.ts's mirror-writer fence.
// inbox-command-store.ts imports from this module; this module must never
// import back from it (that would be a circular dependency).

import { inboxEscalationHistory } from '#/shared/db/schema/inbox-triage-history.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { InboxItem } from '../domain/inbox-types'

type InboxEscalationHistoryKind = 'escalated' | 'resolved'

/**
 * Append one escalation decision keyed by the command revision it produced.
 *
 * `handlingCycleNumber` is the cycle on the row the compare-and-swap returned, so it is the
 * cycle the decision landed in. It stays nullable: an item whose Handling Cycle head is still awaiting
 * repair must still be able to record that it was escalated.
 */
export async function appendEscalationHistory(
  tx: Tx,
  item: InboxItem,
  row: InboxItem,
  handlingCycleNumber: number | null,
  decision: Readonly<{
    kind: InboxEscalationHistoryKind
    actorUserId: string
    occurredAt: Date
  }>,
): Promise<void> {
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
