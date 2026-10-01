// Portal command store — portal group commands.
// Split out of portal-command-store.ts (round 4 F3); composed back behind the
// same PortalCommandStore port by createAtomicPortalCommandStore.

import { and, eq, gte, isNull, lt } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalGroups } from '#/shared/db/schema/portal-group.schema'
import { portalGroupMemberships } from '#/shared/db/schema/people-access.schema'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'
import type {
  AddPortalToGroupCommand,
  CreatePortalGroupCommand,
  DeletePortalGroupCommand,
  MovePortalToGroupCommand,
  PortalCommandStore,
  RemovePortalFromGroupCommand,
  UpdatePortalGroupCommand,
} from '../application/ports/portal-command-store.port'
import { portalError } from '../domain/errors'
import {
  groupMovementEntries,
  portalGroupHistoryEntry,
} from '../domain/portal-group-history'
import { portalGroupToRow } from './mappers/portal-group.mapper'
import { assertCommittedRevision, sameInstant } from './portal-command-guards'
import {
  beginMembership,
  endMembership,
  fencePortalGroup,
  fencePortalGroupsInOrder,
  lockActiveMembership,
  lockSamePropertyPortal,
  recordGroupHistory,
} from './portal-group-writes'

export type PortalGroupCommandStore = Pick<
  PortalCommandStore,
  | 'createPortalGroup'
  | 'updatePortalGroup'
  | 'addPortalToGroup'
  | 'removePortalFromGroup'
  | 'movePortalToGroup'
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

const CREATE_MISMATCH = 'Tenant, resource, or fact mismatch on Portal Group creation'

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
    throw portalError('forbidden', CREATE_MISMATCH)
  }
  assertDepartures(command)
}

/** Each departure must match a fenced source group and describe this new group's member. */
function assertDepartures(command: CreatePortalGroupCommand): void {
  const fenced = new Map(
    command.sourceGroups.map((fence) => [String(fence.portalGroupId), fence]),
  )
  if (fenced.size !== command.sourceGroups.length) {
    throw portalError('forbidden', CREATE_MISMATCH)
  }
  const used = new Set<string>()
  for (const membership of command.memberships) {
    const departure = membership.movedFrom
    if (!departure) continue
    const fence = fenced.get(String(departure.portalGroupId))
    const event = departure.event
    if (
      !fence ||
      departure.portalGroupId === command.group.id ||
      event._tag !== 'portal_group.portal_removed' ||
      event.organizationId !== command.organizationId ||
      event.propertyId !== command.group.propertyId ||
      event.portalGroupId !== departure.portalGroupId ||
      event.portalId !== membership.portalId ||
      event.sourceAggregateVersion !== fence.revision.toISOString() ||
      !sameInstant(event.occurredAt, command.group.createdAt)
    ) {
      throw portalError('forbidden', CREATE_MISMATCH)
    }
    used.add(String(departure.portalGroupId))
  }
  if (used.size !== fenced.size || command.group.createdBy !== command.changedBy) {
    throw portalError('forbidden', CREATE_MISMATCH)
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

function assertMoveCommand(command: MovePortalToGroupCommand): void {
  const sides = [
    ['portal_group.portal_added', command.to],
    ...(command.from ? ([['portal_group.portal_removed', command.from]] as const) : []),
  ] as const
  const mismatch = sides.some(
    ([tag, side]) =>
      side.event._tag !== tag ||
      side.event.organizationId !== command.organizationId ||
      side.event.propertyId !== command.propertyId ||
      side.event.portalGroupId !== side.portalGroupId ||
      side.event.portalId !== command.portalId ||
      side.event.sourceAggregateVersion !== side.revision.toISOString() ||
      !sameInstant(side.event.occurredAt, command.occurredAt),
  )
  if (mismatch || command.from?.portalGroupId === command.to.portalGroupId) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal Group move')
  }
}

/**
 * Put a Portal in a group inside a command transaction: fence the group, check
 * the Portal is an active one of the same Property and not already grouped,
 * write the effective-dated membership, the group history entry and the fact.
 * Shared by the membership command and by Portal creation (the new Portal joins
 * its group in the same commit), so both leave the same rows.
 */
export async function joinPortalGroupInTransaction(
  tx: Tx,
  command: AddPortalToGroupCommand,
): Promise<void> {
  await fencePortalGroup(tx, command)
  await lockSamePropertyPortal(
    tx,
    command,
    'Portal Group membership requires an active same-property Portal',
  )
  const existing = await lockActiveMembership(tx, command)
  if (existing) {
    throw portalError('portal_already_grouped', 'portal is already in a group')
  }
  await beginMembership(tx, {
    ...command,
    at: command.occurredAt,
    createdBy: unbrand(command.changedBy),
  })
  await recordGroupHistory(tx, [
    portalGroupHistoryEntry({
      organizationId: command.organizationId,
      propertyId: command.propertyId,
      portalGroupId: command.portalGroupId,
      kind: 'portal_added',
      portalId: command.portalId,
      actorUserId: unbrand(command.changedBy),
      occurredAt: command.occurredAt,
    }),
  ])
  await insertOutboxRow(tx, command.event, { recordedAt: command.occurredAt })
}

export const createPortalGroupCommands = (db: Database): PortalGroupCommandStore => {
  return {
    createPortalGroup: async (command) =>
      trace('portal.commandStore.createPortalGroup', async () => {
        assertCreatePortalGroupCommand(command)
        const { group } = command
        await db.transaction(async (tx) => {
          await fencePortalGroupsInOrder(
            tx,
            command.sourceGroups.map((fence) => ({
              ...fence,
              organizationId: command.organizationId,
              propertyId: group.propertyId,
            })),
          )
          const [created] = await tx
            .insert(portalGroups)
            .values(portalGroupToRow(group))
            .returning({ updatedAt: portalGroups.updatedAt })
          assertCommittedRevision(
            created,
            group.updatedAt,
            'Portal Group',
            'Portal Group creation did not return its command revision',
          )
          // Portals are locked in id order so two creations over the same Portals
          // queue instead of deadlocking.
          const byPortal = [...command.memberships].sort((left, right) =>
            String(left.portalId).localeCompare(String(right.portalId)),
          )
          for (const membership of byPortal) {
            await lockSamePropertyPortal(
              tx,
              {
                organizationId: command.organizationId,
                propertyId: group.propertyId,
                portalId: membership.portalId,
              },
              'Initial Portal Group membership requires an active same-property Portal',
            )
            const active = await lockActiveMembership(tx, {
              organizationId: command.organizationId,
              portalId: membership.portalId,
            })
            if (membership.movedFrom) {
              if (active?.portalGroupId !== String(membership.movedFrom.portalGroupId)) {
                throw portalError(
                  'revision_conflict',
                  'Portal changed groups while the command was being committed',
                )
              }
              await endMembership(tx, active, group.createdAt, 'moved_to_group')
            } else if (active) {
              throw portalError('portal_already_grouped', 'portal is already in a group')
            }
            await beginMembership(tx, {
              organizationId: command.organizationId,
              propertyId: group.propertyId,
              portalId: membership.portalId,
              portalGroupId: group.id,
              at: group.createdAt,
              createdBy: unbrand(membership.createdBy),
            })
          }
          await recordGroupHistory(tx, [
            portalGroupHistoryEntry({
              organizationId: command.organizationId,
              propertyId: group.propertyId,
              portalGroupId: group.id,
              kind: 'created',
              name: group.name,
              actorUserId: unbrand(command.changedBy),
              occurredAt: group.createdAt,
            }),
            ...command.memberships.flatMap((membership) =>
              groupMovementEntries({
                organizationId: command.organizationId,
                propertyId: group.propertyId,
                portalId: membership.portalId,
                fromGroupId: membership.movedFrom?.portalGroupId ?? null,
                toGroupId: group.id,
                actorUserId: unbrand(membership.createdBy),
                occurredAt: group.createdAt,
              }),
            ),
          ])
          const departures = command.memberships.flatMap((membership) =>
            membership.movedFrom ? [membership.movedFrom.event] : [],
          )
          for (const event of [...command.events, ...departures]) {
            await insertOutboxRow(tx, event, { recordedAt: group.createdAt })
          }
        })
      }),

    updatePortalGroup: async (command) =>
      trace('portal.commandStore.updatePortalGroup', async () => {
        assertUpdatePortalGroupCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalGroup(tx, command, { name: command.name })
          if (command.name !== command.previousName) {
            await recordGroupHistory(tx, [
              portalGroupHistoryEntry({
                organizationId: command.organizationId,
                propertyId: command.propertyId,
                portalGroupId: command.portalGroupId,
                kind: 'renamed',
                name: command.name,
                previousName: command.previousName,
                actorUserId: unbrand(command.changedBy),
                occurredAt: command.occurredAt,
              }),
            ])
          }
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
          const active = await lockActiveMembership(tx, command)
          if (active?.portalGroupId !== String(command.portalGroupId)) {
            throw portalError(
              'portal_not_in_group',
              'portal is not a member of this group',
            )
          }
          await endMembership(tx, active, command.occurredAt, 'removed_from_group')
          await recordGroupHistory(tx, [
            portalGroupHistoryEntry({
              organizationId: command.organizationId,
              propertyId: command.propertyId,
              portalGroupId: command.portalGroupId,
              kind: 'portal_removed',
              portalId: command.portalId,
              actorUserId: unbrand(command.changedBy),
              occurredAt: command.occurredAt,
            }),
          ])
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    movePortalToGroup: async (command) =>
      trace('portal.commandStore.movePortalToGroup', async () => {
        assertMoveCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalGroupsInOrder(
            tx,
            [command.to, ...(command.from ? [command.from] : [])].map((fence) => ({
              ...fence,
              organizationId: command.organizationId,
              propertyId: command.propertyId,
            })),
          )
          await lockSamePropertyPortal(
            tx,
            command,
            'Portal Group membership requires an active same-property Portal',
          )
          const active = await lockActiveMembership(tx, command)
          if (command.from) {
            if (active?.portalGroupId !== String(command.from.portalGroupId)) {
              throw portalError(
                'revision_conflict',
                'Portal changed groups while the move was being committed',
              )
            }
            await endMembership(tx, active, command.occurredAt, 'moved_to_group')
          } else if (active) {
            throw portalError('portal_already_grouped', 'portal is already in a group')
          }
          await beginMembership(tx, {
            ...command,
            portalGroupId: command.to.portalGroupId,
            at: command.occurredAt,
            createdBy: unbrand(command.changedBy),
          })
          await recordGroupHistory(
            tx,
            groupMovementEntries({
              organizationId: command.organizationId,
              propertyId: command.propertyId,
              portalId: command.portalId,
              fromGroupId: command.from?.portalGroupId ?? null,
              toGroupId: command.to.portalGroupId,
              actorUserId: unbrand(command.changedBy),
              occurredAt: command.occurredAt,
            }),
          )
          for (const event of [command.from?.event, command.to.event]) {
            if (event)
              await insertOutboxRow(tx, event, { recordedAt: command.occurredAt })
          }
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
          await recordGroupHistory(tx, [
            portalGroupHistoryEntry({
              organizationId: command.organizationId,
              propertyId: command.propertyId,
              portalGroupId: command.portalGroupId,
              kind: 'archived',
              actorUserId: unbrand(command.changedBy),
              occurredAt: command.occurredAt,
            }),
          ])

          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),
  }
}
