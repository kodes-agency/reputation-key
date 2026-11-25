// ADR 0060: content and address commands lock the Portal row before its owned rows.

import type { Database } from '#/shared/db'
import type { IssuePortalTokenCommand } from './portal-command-store-port.server'
import { portalError } from '../domain/errors'
import { assertRevisionAdvances, casPortalRow } from './portal-command-guards.server'

export type PortalAggregateFence = Readonly<{
  organizationId: IssuePortalTokenCommand['organizationId']
  propertyId: IssuePortalTokenCommand['propertyId']
  portalId: IssuePortalTokenCommand['portalId']
  expectedPortalUpdatedAt: Date
  revision: Date
  occurredAt: Date
}>

/** Address management stays available even when the Portal is archived. */
export async function fencePortalRevision(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  command: PortalAggregateFence,
) {
  assertRevisionAdvances(command.revision, command.expectedPortalUpdatedAt, 'Portal')
  const updated = await casPortalRow(
    tx,
    command,
    { expected: command.expectedPortalUpdatedAt, next: command.revision },
    { conflictMessage: 'Portal content changed while the command was being committed' },
  )
  return updated.publicationState
}

export async function fencePortalContent(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  command: PortalAggregateFence,
): Promise<void> {
  // UPDATE holds the Portal lock; throwing here rolls its revision back with
  // the command, before any content, ledger entry or outbox fact is written.
  if ((await fencePortalRevision(tx, command)) === 'archived') {
    throw portalError(
      'portal_inactive',
      'Archived Portal configuration is read-only; restore it before editing',
    )
  }
}
