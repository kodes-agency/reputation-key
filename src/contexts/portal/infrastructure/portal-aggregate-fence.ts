// Portal command store — the Portal aggregate fence shared by the link and
// token command modules. ADR 0060: every content or token command takes this
// fence (the Portal row) before it locks anything else.

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

export async function fencePortalContent(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  command: PortalAggregateFence,
): Promise<void> {
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
    .returning({ updatedAt: portals.updatedAt })
  assertCommittedRevision(
    updated,
    command.revision,
    'Portal',
    'Portal content changed while the command was being committed',
  )
}
