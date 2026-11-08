// ADR 0060: content and address commands lock the Portal row before its owned rows.

import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portals } from '#/shared/db/schema'
import { unbrand } from '#/shared/domain/ids'
import type { IssuePortalTokenCommand } from '../application/ports/portal-command-store.port'
import { portalError } from '../domain/errors'
import { assertCommittedRevision } from './portal-command-guards'

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
  if (command.revision.getTime() <= command.expectedPortalUpdatedAt.getTime()) {
    throw portalError(
      'revision_conflict',
      'Portal command revision must advance monotonically',
    )
  }
  const [updated] = await tx
    .update(portals)
    .set({ updatedAt: command.revision })
    .where(
      and(
        eq(portals.organizationId, unbrand(command.organizationId)),
        eq(portals.propertyId, unbrand(command.propertyId)),
        eq(portals.id, unbrand(command.portalId)),
        eq(portals.updatedAt, command.expectedPortalUpdatedAt),
        isNull(portals.deletedAt),
      ),
    )
    .returning({
      updatedAt: portals.updatedAt,
      publicationState: portals.publicationState,
    })
  assertCommittedRevision(
    updated,
    command.revision,
    'Portal',
    'Portal content changed while the command was being committed',
  )
  return updated?.publicationState
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
