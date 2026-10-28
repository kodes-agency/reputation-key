// Manager priority for the atomic inbox command store (ADR 0071).
//
// The store's `setPriority` writes the three `inbox_items` columns through its
// own `transition()` — it is the one module allowed to write that table
// (inbox-status-mirror.guard.test.ts) — and this module supplies the rest: the
// columns a set or a reset writes, the fail-closed check on the command's
// fact, and the append-only history row, which targets
// `inbox_priority_history` and never `inbox_items`. inbox-command-store.ts
// imports from this module; this module must never import back from it.

import { inboxPriorityHistory } from '#/shared/db/schema/inbox-triage-history.schema'
import type { UserId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import { inboxError } from '../domain/errors'
import type { InboxItemPriorityChanged } from '../domain/events'
import type { InboxItem, InboxPriority } from '../domain/types'
import { webActorId } from './inbox-command-guards'
import { readCurrentCycleNumber } from './inbox-escalation-history'

type PriorityUpdate = Readonly<{ priority: InboxPriority | null; setBy: UserId }>

/** The `inbox_items` columns a set or a reset writes: all three, or none. */
export function managerPriorityColumns(
  priority: InboxPriority | null,
  setBy: UserId,
  at: Date,
): Record<string, unknown> {
  return priority === null
    ? {
        managerPriority: null,
        managerPrioritySetBy: null,
        managerPrioritySetAt: null,
        updatedAt: at,
      }
    : {
        managerPriority: priority,
        managerPrioritySetBy: setBy,
        managerPrioritySetAt: at,
        updatedAt: at,
      }
}

/**
 * Refuse a priority write that no signed-in manager made. `transition()` takes
 * the principal it re-authorizes from the fact (`webActorId`), and with none it
 * checks no authority at all; a priority is only ever a person's choice, so a
 * fact without a web actor — or one that disagrees with the write it rides
 * with — never reaches the transaction.
 */
export function guardPriorityCommand(
  item: InboxItem,
  updates: PriorityUpdate,
  event: InboxItemPriorityChanged,
): void {
  if (webActorId(event) !== updates.setBy) {
    throw inboxError('forbidden', 'A priority is set only by a signed-in manager')
  }
  if (
    event.inboxItemId !== item.id ||
    event.priority !== updates.priority ||
    event.previousPriority !== (item.managerPriority ?? null)
  ) {
    throw inboxError('invalid_input', 'The priority fact does not match the command')
  }
}

/**
 * Append one priority decision, keyed by the command revision it produced.
 * `previousPriority` is the loaded item's level: the compare-and-swap that
 * produced `row` proves it was still the one in force. The Handling Cycle is
 * read after the item lock, as escalation history reads it.
 */
export async function appendPriorityHistory(
  tx: Tx,
  item: InboxItem,
  row: InboxItem,
  decision: Readonly<{
    priority: InboxPriority | null
    actorUserId: UserId
    occurredAt: Date
  }>,
): Promise<void> {
  const handlingCycleNumber = await readCurrentCycleNumber(tx, item)
  await tx.insert(inboxPriorityHistory).values({
    inboxItemId: row.id,
    resultingCommandRevision: row.commandRevision,
    organizationId: item.organizationId,
    propertyId: item.propertyId,
    handlingCycleNumber,
    priority: decision.priority,
    previousPriority: item.managerPriority ?? null,
    actorUserId: decision.actorUserId,
    occurredAt: decision.occurredAt,
  })
}
