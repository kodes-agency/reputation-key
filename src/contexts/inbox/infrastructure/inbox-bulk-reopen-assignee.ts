// The assignee half of a bulk reopen (invariant 4), for the atomic inbox
// command store. Split out of inbox-command-store.ts (to keep it within its
// length ratchet when manager priority arrived, ADR 0071): it reads the
// assignee's authority and builds the unassignment fact, and writes nothing —
// so it is outside inbox-status-mirror.guard.test.ts's writer fence.
// inbox-command-store.ts imports from this module; this module must never
// import back from it.

import { userId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import { inboxError } from '../domain/errors'
import { inboxItemUnassigned } from '../domain/events'
import type { InboxItem } from '../domain/types'
import type { InboxCommandAuthority } from './inbox-command-authority'
import { sourceCommandPermission, type PersistedItem } from './inbox-command-guards'

/**
 * An assignee who no longer holds handling authority is dropped with an
 * unassignment fact. A changed authority contract is a conflict instead: the
 * command was planned against an authority state that no longer exists.
 */
export async function resolveBulkReopenAssignee(
  tx: Tx,
  authorizeCommand: InboxCommandAuthority,
  item: InboxItem,
  itemRow: PersistedItem,
  actorId: string,
  now: Date,
): Promise<
  Readonly<{
    assignedTo: string | null
    unassignedFact: ReturnType<typeof inboxItemUnassigned> | null
  }>
> {
  const assignedTo = itemRow.assignedTo
  if (assignedTo === null) return { assignedTo: null, unassignedFact: null }
  const eligibility = await authorizeCommand(tx, {
    organizationId: itemRow.organizationId,
    at: now,
    requirements: [
      {
        propertyId: itemRow.propertyId,
        userId: assignedTo,
        permissions: ['inbox.write', sourceCommandPermission(itemRow.sourceType)],
        purpose: 'assignee',
      },
    ],
  })
  if (eligibility.allowed) return { assignedTo, unassignedFact: null }
  if (
    eligibility.reason.includes('authority_changed') ||
    eligibility.reason.includes('contract_mismatch')
  ) {
    throw inboxError(
      'revision_conflict',
      'Inbox assignment authority changed during bulk reopen',
      { authorityReason: eligibility.reason },
    )
  }
  return {
    assignedTo: null,
    unassignedFact: inboxItemUnassigned({
      inboxItemId: item.id,
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      userId: userId(actorId),
      previousAssignee: userId(assignedTo),
      source: 'web',
      occurredAt: now,
    }),
  }
}
