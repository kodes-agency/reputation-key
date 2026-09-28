// Escalation history for the atomic inbox command store (BQC-3.4, ADR 0055).
// Split out of inbox-command-store.ts (code-health-02 phase 1): every write
// here targets `inbox_escalation_history`, never `inbox_items`, so none of it
// is subject to inbox-status-mirror.guard.test.ts's mirror-writer fence.
// inbox-command-store.ts imports from this module; this module must never
// import back from it (that would be a circular dependency).

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  inboxEscalationHistory,
  inboxHandlingCycleHeads,
  inboxItems,
} from '#/shared/db/schema/inbox.schema'
import type { Tx } from '#/shared/outbox/commit'
import { inboxError } from '../domain/errors'
import type { InboxItem } from '../domain/types'

export const INBOX_ESCALATION_HISTORY_KINDS = ['escalated', 'resolved'] as const

export type InboxEscalationHistoryKind = (typeof INBOX_ESCALATION_HISTORY_KINDS)[number]

export type InboxEscalationHistoryEntry = Readonly<{
  inboxItemId: string
  resultingCommandRevision: number
  handlingCycleNumber: number | null
  kind: InboxEscalationHistoryKind
  actorUserId: string | null
  occurredAt: Date
}>

/**
 * `recorded` — every escalation decision on this item is present below.
 * `legacy_unknown` — the item carries escalation flags written before
 * migration 0169, so its earlier decisions have no actor and no time that this
 * system can honestly name. It is never back-filled with an invented value.
 */
export type InboxEscalationProvenance = 'recorded' | 'legacy_unknown'

export type InboxEscalationHistoryView = Readonly<{
  provenance: InboxEscalationProvenance
  currentlyEscalated: boolean
  entries: readonly InboxEscalationHistoryEntry[]
}>

/**
 * Resolve the source Handling Cycle that owns a human assignment or
 * escalation decision.
 *
 * This read intentionally happens before the Inbox item compare-and-swap and
 * does not lock the head. Cycle commands lock head -> item. If one of
 * those commands commits first, the item revision CAS rejects this command;
 * if this command wins the item row, the cycle observed here is the cycle in
 * which the decision occurred.
 */
export async function readCurrentCycleNumber(
  tx: Tx,
  item: InboxItem,
): Promise<number | null> {
  const rows = await tx
    .select({ currentCycleNumber: inboxHandlingCycleHeads.currentCycleNumber })
    .from(inboxHandlingCycleHeads)
    .where(
      and(
        eq(inboxHandlingCycleHeads.inboxItemId, item.id),
        eq(inboxHandlingCycleHeads.organizationId, item.organizationId),
        eq(inboxHandlingCycleHeads.propertyId, item.propertyId),
        eq(inboxHandlingCycleHeads.sourceType, item.sourceType),
        eq(inboxHandlingCycleHeads.sourceId, item.sourceId),
      ),
    )
    .limit(1)
  const cycleNumber = rows[0]?.currentCycleNumber
  return Number.isSafeInteger(cycleNumber) && cycleNumber >= 1 ? cycleNumber : null
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

/**
 * Read the complete escalation history of one Inbox item.
 *
 * Escalation is an independent workflow dimension (ADR 0055): this read grants
 * no access and never reports a status. An item whose flags predate migration
 * 0169 is still readable — it is reported as `legacy_unknown` so a manager
 * sees "escalated, provenance unknown" instead of a fabricated actor/time.
 */
export async function readInboxEscalationHistory(
  db: Database,
  item: Readonly<{ id: string; organizationId: string }>,
): Promise<InboxEscalationHistoryView> {
  const [heads, rows] = await Promise.all([
    db
      .select({
        isEscalated: inboxItems.isEscalated,
        escalatedAt: inboxItems.escalatedAt,
        escalationResolvedAt: inboxItems.escalationResolvedAt,
      })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.id, item.id),
          eq(inboxItems.organizationId, item.organizationId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(inboxEscalationHistory)
      .where(eq(inboxEscalationHistory.inboxItemId, item.id))
      .orderBy(
        inboxEscalationHistory.occurredAt,
        inboxEscalationHistory.resultingCommandRevision,
      ),
  ])
  const head = heads[0]
  if (!head) throw inboxError('not_found', 'Inbox item was not found')
  const entries = rows.map((row) => ({
    inboxItemId: row.inboxItemId,
    resultingCommandRevision: row.resultingCommandRevision,
    handlingCycleNumber: row.handlingCycleNumber,
    kind: row.kind as InboxEscalationHistoryKind,
    actorUserId: row.actorUserId,
    occurredAt: row.occurredAt,
  }))
  const everEscalated = head.escalatedAt !== null || head.escalationResolvedAt !== null
  return {
    provenance: everEscalated && entries.length === 0 ? 'legacy_unknown' : 'recorded',
    currentlyEscalated: head.isEscalated && head.escalationResolvedAt === null,
    entries,
  }
}
