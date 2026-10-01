// Portal command store — portal group commands.
// Split out of portal-command-store.ts (round 4 F3); composed back behind the
// same PortalCommandStore port by createAtomicPortalCommandStore.

import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portals } from '#/shared/db/schema'
import { portalGroups } from '#/shared/db/schema/portal-group.schema'
import { portalGroupMemberships } from '#/shared/db/schema/people-access.schema'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'
import type {
  AddPortalToGroupCommand,
  CreatePortalGroupCommand,
  DeletePortalGroupCommand,
  PortalCommandStore,
  RemovePortalFromGroupCommand,
  UpdatePortalGroupCommand,
} from '../application/ports/portal-command-store.port'
import { portalError } from '../domain/errors'
import { portalGroupToRow } from './mappers/portal-group.mapper'
import { assertCommittedRevision, sameInstant } from './portal-command-guards'

export type PortalGroupCommandStore = Pick<
  PortalCommandStore,
  | 'createPortalGroup'
  | 'updatePortalGroup'
  | 'addPortalToGroup'
  | 'removePortalFromGroup'
  | 'deletePortalGroup'
>

function assertDeletePortalGroupCommand(command: DeletePortalGroupCommand): void {
  const { event } = command
  if (
    event.organizationId !== command.organizationId ||
    event.propertyId !== command.propertyId ||
    event.portalGroupId !== command.portalGroupId ||
    event.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(event.occurredAt, command.occurredAt)
  ) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal Group delete')
  }
  if (command.revision.getTime() <= command.expectedUpdatedAt.getTime()) {
    throw portalError(
      'revision_conflict',
      'Portal Group command revision must advance monotonically',
    )
  }
}

function assertCreatePortalGroupCommand(command: CreatePortalGroupCommand): void {
  const [created, ...membershipEvents] = command.events
  if (
    command.group.organizationId !== command.organizationId ||
    created._tag !== 'portal_group.created' ||
    created.organizationId !== command.organizationId ||
    created.propertyId !== command.group.propertyId ||
    created.portalGroupId !== command.group.id ||
    created.sourceAggregateVersion !== command.group.updatedAt.toISOString() ||
    !sameInstant(created.occurredAt, command.group.createdAt) ||
    membershipEvents.length !== command.memberships.length ||
    membershipEvents.some((event, index) => {
      const membership = command.memberships[index]
      return (
        !membership ||
        event._tag !== 'portal_group.portal_added' ||
        event.organizationId !== command.organizationId ||
        event.propertyId !== command.group.propertyId ||
        event.portalGroupId !== command.group.id ||
        event.portalId !== membership.portalId ||
        event.sourceAggregateVersion !== command.group.updatedAt.toISOString() ||
        !sameInstant(event.occurredAt, command.group.createdAt)
      )
    })
  ) {
    throw portalError(
      'forbidden',
      'Tenant, resource, or fact mismatch on Portal Group creation',
    )
  }
}

function assertUpdatePortalGroupCommand(command: UpdatePortalGroupCommand): void {
  if (
    command.event.organizationId !== command.organizationId ||
    command.event.propertyId !== command.propertyId ||
    command.event.portalGroupId !== command.portalGroupId ||
    command.event.name !== command.name ||
    command.event.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(command.event.occurredAt, command.occurredAt)
  ) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal Group update')
  }
}

export function assertMembershipCommand(
  command: AddPortalToGroupCommand | RemovePortalFromGroupCommand,
  expectedTag: 'portal_group.portal_added' | 'portal_group.portal_removed',
): void {
  if (
    command.event._tag !== expectedTag ||
    command.event.organizationId !== command.organizationId ||
    command.event.propertyId !== command.propertyId ||
    command.event.portalGroupId !== command.portalGroupId ||
    command.event.portalId !== command.portalId ||
    command.event.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(command.event.occurredAt, command.occurredAt)
  ) {
    throw portalError(
      'forbidden',
      'Tenant or resource mismatch on Portal Group membership change',
    )
  }
}

async function fencePortalGroup(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  command: Readonly<{
    organizationId: CreatePortalGroupCommand['organizationId']
    propertyId: CreatePortalGroupCommand['group']['propertyId']
    portalGroupId: CreatePortalGroupCommand['group']['id']
    expectedUpdatedAt: Date
    revision: Date
    occurredAt: Date
  }>,
  patch: Readonly<{ name?: string }> = {},
): Promise<void> {
  if (command.revision.getTime() <= command.expectedUpdatedAt.getTime()) {
    throw portalError(
      'revision_conflict',
      'Portal Group command revision must advance monotonically',
    )
  }
  const [updated] = await tx
    .update(portalGroups)
    .set({ ...patch, updatedAt: command.revision })
    .where(
      and(
        eq(portalGroups.organizationId, unbrand(command.organizationId)),
        eq(portalGroups.propertyId, unbrand(command.propertyId)),
        eq(portalGroups.id, unbrand(command.portalGroupId)),
        eq(portalGroups.updatedAt, command.expectedUpdatedAt),
        isNull(portalGroups.deletedAt),
      ),
    )
    .returning({ updatedAt: portalGroups.updatedAt })
  assertCommittedRevision(
    updated,
    command.revision,
    'Portal Group',
    'Portal Group changed while the command was being committed',
  )
}

/**
 * Put a Portal in a group inside a command transaction: fence the group, check
 * the Portal is an active one of the same Property and not already grouped,
 * write the effective-dated membership and its fact. Shared by the membership
 * command and by Portal creation (the new Portal joins its group in the same
 * commit), so both hold the same rules.
 */
export async function joinPortalGroupInTransaction(
  tx: Tx,
  command: AddPortalToGroupCommand,
): Promise<void> {
  await fencePortalGroup(tx, command)
  await tx.execute(sql`
    SELECT id FROM portals
    WHERE organization_id = ${unbrand(command.organizationId)}
      AND property_id = ${unbrand(command.propertyId)}
      AND id = ${unbrand(command.portalId)}
      AND deleted_at IS NULL
    FOR UPDATE
  `)
  const [portal] = await tx
    .select({ id: portals.id })
    .from(portals)
    .where(
      and(
        eq(portals.organizationId, unbrand(command.organizationId)),
        eq(portals.propertyId, unbrand(command.propertyId)),
        eq(portals.id, unbrand(command.portalId)),
        isNull(portals.deletedAt),
      ),
    )
    .limit(1)
  if (!portal) {
    throw portalError(
      'forbidden',
      'Portal Group membership requires an active same-property Portal',
    )
  }
  await tx.execute(sql`
    SELECT id FROM portal_group_memberships
    WHERE organization_id = ${unbrand(command.organizationId)}
      AND portal_id = ${unbrand(command.portalId)}
      AND effective_to IS NULL
    FOR UPDATE
  `)
  const [existing] = await tx
    .select({ id: portalGroupMemberships.id })
    .from(portalGroupMemberships)
    .where(
      and(
        eq(portalGroupMemberships.organizationId, unbrand(command.organizationId)),
        eq(portalGroupMemberships.portalId, unbrand(command.portalId)),
        isNull(portalGroupMemberships.effectiveTo),
      ),
    )
    .limit(1)
  if (existing) {
    throw portalError('portal_already_grouped', 'portal is already in a group')
  }
  await tx.insert(portalGroupMemberships).values({
    organizationId: unbrand(command.organizationId),
    propertyId: unbrand(command.propertyId),
    portalId: unbrand(command.portalId),
    portalGroupId: unbrand(command.portalGroupId),
    effectiveFrom: command.occurredAt,
    createdBy: unbrand(command.changedBy),
  })
  await insertOutboxRow(tx, command.event, { recordedAt: command.occurredAt })
}

export const createPortalGroupCommands = (db: Database): PortalGroupCommandStore => {
  return {
    createPortalGroup: async (command) =>
      trace('portal.commandStore.createPortalGroup', async () => {
        assertCreatePortalGroupCommand(command)
        await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(portalGroups)
            .values(portalGroupToRow(command.group))
            .returning({ updatedAt: portalGroups.updatedAt })
          assertCommittedRevision(
            created,
            command.group.updatedAt,
            'Portal Group',
            'Portal Group creation did not return its command revision',
          )
          for (const membership of command.memberships) {
            await tx.execute(sql`
              SELECT id FROM portals
              WHERE organization_id = ${unbrand(command.organizationId)}
                AND property_id = ${unbrand(command.group.propertyId)}
                AND id = ${unbrand(membership.portalId)}
                AND deleted_at IS NULL
              FOR UPDATE
            `)
            const [portal] = await tx
              .select({ id: portals.id })
              .from(portals)
              .where(
                and(
                  eq(portals.organizationId, unbrand(command.organizationId)),
                  eq(portals.propertyId, unbrand(command.group.propertyId)),
                  eq(portals.id, unbrand(membership.portalId)),
                  isNull(portals.deletedAt),
                ),
              )
              .limit(1)
            if (!portal) {
              throw portalError(
                'forbidden',
                'Initial Portal Group membership requires an active same-property Portal',
              )
            }
            await tx.insert(portalGroupMemberships).values({
              organizationId: unbrand(command.organizationId),
              propertyId: unbrand(command.group.propertyId),
              portalId: unbrand(membership.portalId),
              portalGroupId: unbrand(command.group.id),
              effectiveFrom: command.group.createdAt,
              createdBy: unbrand(membership.createdBy),
            })
          }
          for (const event of command.events) {
            await insertOutboxRow(tx, event, { recordedAt: command.group.createdAt })
          }
        })
      }),

    updatePortalGroup: async (command) =>
      trace('portal.commandStore.updatePortalGroup', async () => {
        assertUpdatePortalGroupCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalGroup(tx, command, { name: command.name })
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    addPortalToGroup: async (command) =>
      trace('portal.commandStore.addPortalToGroup', async () => {
        assertMembershipCommand(command, 'portal_group.portal_added')
        await db.transaction((tx) => joinPortalGroupInTransaction(tx, command))
      }),

    removePortalFromGroup: async (command) =>
      trace('portal.commandStore.removePortalFromGroup', async () => {
        assertMembershipCommand(command, 'portal_group.portal_removed')
        await db.transaction(async (tx) => {
          await fencePortalGroup(tx, command)
          await tx.execute(sql`
            SELECT id FROM portal_group_memberships
            WHERE organization_id = ${unbrand(command.organizationId)}
              AND property_id = ${unbrand(command.propertyId)}
              AND portal_group_id = ${unbrand(command.portalGroupId)}
              AND portal_id = ${unbrand(command.portalId)}
              AND effective_to IS NULL
            FOR UPDATE
          `)
          const [active] = await tx
            .select()
            .from(portalGroupMemberships)
            .where(
              and(
                eq(
                  portalGroupMemberships.organizationId,
                  unbrand(command.organizationId),
                ),
                eq(portalGroupMemberships.propertyId, unbrand(command.propertyId)),
                eq(portalGroupMemberships.portalGroupId, unbrand(command.portalGroupId)),
                eq(portalGroupMemberships.portalId, unbrand(command.portalId)),
                isNull(portalGroupMemberships.effectiveTo),
              ),
            )
            .limit(1)
          if (!active) {
            throw portalError(
              'portal_not_in_group',
              'portal is not a member of this group',
            )
          }
          if (active.effectiveFrom >= command.occurredAt) {
            await tx
              .delete(portalGroupMemberships)
              .where(eq(portalGroupMemberships.id, active.id))
          } else {
            await tx
              .update(portalGroupMemberships)
              .set({
                effectiveTo: command.occurredAt,
                endReason: 'removed_from_group',
              })
              .where(eq(portalGroupMemberships.id, active.id))
          }
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    deletePortalGroup: async (command) =>
      trace('portal.commandStore.deletePortalGroup', async () => {
        assertDeletePortalGroupCommand(command)
        await db.transaction(async (tx) => {
          const [deleted] = await tx
            .update(portalGroups)
            .set({ deletedAt: command.occurredAt, updatedAt: command.revision })
            .where(
              and(
                eq(portalGroups.organizationId, unbrand(command.organizationId)),
                eq(portalGroups.propertyId, unbrand(command.propertyId)),
                eq(portalGroups.id, unbrand(command.portalGroupId)),
                eq(portalGroups.updatedAt, command.expectedUpdatedAt),
                isNull(portalGroups.deletedAt),
              ),
            )
            .returning({ updatedAt: portalGroups.updatedAt })
          assertCommittedRevision(
            deleted,
            command.revision,
            'Portal Group',
            'Portal Group changed while the delete was being committed',
          )

          const membershipScope = [
            eq(portalGroupMemberships.organizationId, unbrand(command.organizationId)),
            eq(portalGroupMemberships.propertyId, unbrand(command.propertyId)),
            eq(portalGroupMemberships.portalGroupId, unbrand(command.portalGroupId)),
            isNull(portalGroupMemberships.effectiveTo),
          ] as const
          await tx
            .delete(portalGroupMemberships)
            .where(
              and(
                ...membershipScope,
                gte(portalGroupMemberships.effectiveFrom, command.occurredAt),
              ),
            )
          await tx
            .update(portalGroupMemberships)
            .set({
              effectiveTo: command.occurredAt,
              endReason: 'group_archived',
            })
            .where(
              and(
                ...membershipScope,
                lt(portalGroupMemberships.effectiveFrom, command.occurredAt),
              ),
            )

          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),
  }
}
