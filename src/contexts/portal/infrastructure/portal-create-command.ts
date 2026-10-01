// Portal command store — the create-Portal command.
// Split out of portal-command-store.ts (it grew group, copy and manager parts);
// composed back behind the same PortalCommandStore port by
// createAtomicPortalCommandStore.
//
// One transaction writes the Portal, who is responsible, its first Health, its
// group membership, everything copied from another Portal and every fact. A
// failure in any part leaves no trace of the others.

import type { Database } from '#/shared/db'
import {
  portalHealthIntervals,
  portalLinkCategories,
  portalLinks,
  portalLocalizedOverrides,
  portalResponsibleManagers,
  portals,
} from '#/shared/db/schema'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'
import type {
  CreatePortalCommand,
  CreatePortalCopiedContent,
  PortalCommandStore,
} from '../application/ports/portal-command-store.port'
import { categoryToRow, linkToRow } from './mappers/portal-link.mapper'
import { portalToRow } from './mappers/portal.mapper'
import { assertCommittedRevision } from './portal-command-guards'
import { assertCreateCommand } from './portal-create-guards'
import { joinPortalGroupInTransaction } from './portal-group-commands'
import { upsertLinkTexts } from './portal-link-texts-store'

export type PortalCreateCommandStore = Pick<PortalCommandStore, 'createPortal'>

async function insertResponsibleManagers(
  tx: Tx,
  command: CreatePortalCommand,
): Promise<void> {
  if (command.initialResponsibleManagerIds.length === 0) return
  const { portal } = command
  await tx.insert(portalResponsibleManagers).values(
    command.initialResponsibleManagerIds.map((userId) => ({
      organizationId: command.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      userId,
      effectiveFrom: portal.createdAt,
      createdBy: portal.createdBy ?? userId,
    })),
  )
}

async function insertCopiedContent(
  tx: Tx,
  command: CreatePortalCommand,
  copy: CreatePortalCopiedContent,
): Promise<void> {
  const { portal } = command
  const organizationId = unbrand(command.organizationId)
  const propertyId = unbrand(portal.propertyId)
  const writer = { actorUserId: portal.createdBy ?? '', at: portal.createdAt }
  if (copy.overrides.length > 0) {
    await tx.insert(portalLocalizedOverrides).values(
      copy.overrides.map((override) => ({
        id: override.id,
        organizationId,
        propertyId,
        portalId: unbrand(portal.id),
        locale: override.locale,
        title: override.title,
        shortDescription: override.shortDescription,
        heroImageUrl: null,
        linktreeTitle: override.linktreeTitle,
        version: 1,
        updatedBy: writer.actorUserId,
        createdAt: writer.at,
        updatedAt: writer.at,
      })),
    )
  }
  if (copy.categories.length > 0) {
    await tx.insert(portalLinkCategories).values(copy.categories.map(categoryToRow))
  }
  if (copy.links.length === 0) return
  await tx.insert(portalLinks).values(copy.links.map(linkToRow))
  for (const link of copy.links) {
    await upsertLinkTexts(
      tx,
      {
        organizationId,
        propertyId,
        portalId: unbrand(portal.id),
        linkId: unbrand(link.id),
      },
      writer,
      copy.linkTexts.filter((text) => text.linkId === link.id),
    )
  }
}

async function joinGroup(tx: Tx, command: CreatePortalCommand): Promise<void> {
  const membership = command.groupMembership
  if (!membership) return
  const { portal } = command
  await joinPortalGroupInTransaction(tx, {
    organizationId: command.organizationId,
    propertyId: portal.propertyId,
    portalGroupId: membership.portalGroupId,
    portalId: portal.id,
    expectedUpdatedAt: membership.expectedGroupUpdatedAt,
    revision: membership.revision,
    occurredAt: portal.createdAt,
    changedBy:
      portal.createdBy ?? command.initialResponsibleManagerIds[0] ?? ('' as never),
    event: membership.event,
  })
}

export const createPortalCreateCommand = (db: Database): PortalCreateCommandStore => ({
  createPortal: async (command) =>
    trace('portal.commandStore.createPortal', async () => {
      assertCreateCommand(command)
      await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(portals)
          .values(portalToRow(command.portal))
          .returning({ updatedAt: portals.updatedAt })
        assertCommittedRevision(
          created,
          command.portal.updatedAt,
          'Portal',
          'Portal creation did not return its command revision',
        )
        await insertResponsibleManagers(tx, command)
        if (command.health) {
          await tx.insert(portalHealthIntervals).values({
            id: command.health.id,
            organizationId: unbrand(command.organizationId),
            propertyId: unbrand(command.portal.propertyId),
            portalId: unbrand(command.portal.id),
            status: command.health.value.status,
            reason: command.health.value.reason,
            sourceVersion: command.health.sourceVersion,
            effectiveFrom: command.health.effectiveAt,
            effectiveTo: null,
            observedAt: command.health.observedAt,
          })
        }
        if (command.copiedContent) {
          await insertCopiedContent(tx, command, command.copiedContent)
        }
        await joinGroup(tx, command)
        await insertOutboxRow(tx, command.event, {
          recordedAt: command.portal.createdAt,
        })
        if (command.responsibilityNeededEvent) {
          await insertOutboxRow(tx, command.responsibilityNeededEvent, {
            recordedAt: command.portal.createdAt,
          })
        }
      })
    }),
})
