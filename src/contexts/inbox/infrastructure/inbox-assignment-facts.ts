import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { inboxError } from '../domain/errors'
import type { InboxItemAssigned, InboxItemUnassigned } from '../domain/events'
import type { InboxItem } from '../domain/types'
import { readCurrentCycleNumber } from './inbox-escalation-history'

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
  const cycleNumber = await readCurrentCycleNumber(tx, item)
  if (cycleNumber === null) {
    throw inboxError(
      'not_found',
      'Inbox item has no current Handling Cycle for assignment',
    )
  }
  return cycleNumber
}
