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
import { unbrand, type UserId } from '#/shared/domain/ids'
import type {
  CreatePortalCommand,
  CreatePortalCopiedContent,
  PortalCommandStore,
} from '../application/ports/portal-command-store.port'
import { portalError } from '../domain/errors'
import { categoryToRow, linkToRow } from './mappers/portal-link.mapper'
import { portalToRow } from './mappers/portal.mapper'
import { assertCommittedRevision } from './portal-command-guards'
import { assertCreateCommand } from './portal-create-guards'
import { joinPortalGroupInTransaction } from './portal-group-commands'
import { upsertLinkTexts } from './portal-link-texts-store'

export type PortalCreateCommandStore = Pick<PortalCommandStore, 'createPortal'>

/** The person who created the Portal; every write beyond the Portal row is attributed to them. */
function creatorOf(command: CreatePortalCommand): UserId {
  const { createdBy } = command.portal
  if (createdBy === null) {
    throw portalError(
      'forbidden',
      'A Portal created with group or copied content needs its creator',
    )
  }
  return createdBy
}

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
  const writer = { actorUserId: unbrand(creatorOf(command)), at: portal.createdAt }
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
    changedBy: creatorOf(command),
    event: membership.event,
  })
}

async function insertInitialHealth(tx: Tx, command: CreatePortalCommand): Promise<void> {
  const { health, portal } = command
  if (!health) return
  await tx.insert(portalHealthIntervals).values({
    id: health.id,
    organizationId: unbrand(command.organizationId),
    propertyId: unbrand(portal.propertyId),
    portalId: unbrand(portal.id),
    status: health.value.status,
    reason: health.value.reason,
    sourceVersion: health.sourceVersion,
    effectiveFrom: health.effectiveAt,
    effectiveTo: null,
    observedAt: health.observedAt,
  })
}

const SLUG_UNIQUE_CONSTRAINT = 'portals_org_property_slug_unique'

/** Whether the database refused the Portal because its address is already in use at the Property. */
function isSlugConflict(error: unknown): boolean {
  let current = error
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== 'object') return false
    const { code, constraint } = current as { code?: unknown; constraint?: unknown }
    if (code === '23505' && constraint === SLUG_UNIQUE_CONSTRAINT) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export const createPortalCreateCommand = (db: Database): PortalCreateCommandStore => ({
  createPortal: async (command) =>
    trace('portal.commandStore.createPortal', async () => {
      assertCreateCommand(command)
      try {
        await commitCreate(db, command)
      } catch (error) {
        if (isSlugConflict(error)) {
          throw portalError('slug_taken', 'a portal with this slug already exists')
        }
        throw error
      }
    }),
})

async function commitCreate(db: Database, command: CreatePortalCommand): Promise<void> {
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
    await insertInitialHealth(tx, command)
    if (command.copiedContent) {
      await insertCopiedContent(tx, command, command.copiedContent)
    }
    await joinGroup(tx, command)
    await insertOutboxRow(tx, command.event, { recordedAt: command.portal.createdAt })
    if (command.responsibilityNeededEvent) {
      await insertOutboxRow(tx, command.responsibilityNeededEvent, {
        recordedAt: command.portal.createdAt,
      })
    }
  })
}
