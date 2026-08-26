// Atomic Portal command store (ARC-01).
//
// Portal state, responsibility/token side effects, and every required durable
// lifecycle fact commit in one PostgreSQL transaction. The EventBus is only a
// post-commit acceleration path; the outbox remains the recovery authority.

import { and, eq, isNull, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalResponsibleManagers,
  portals,
  portalTokens,
} from '#/shared/db/schema/portal.schema'
import type { EventBus } from '#/shared/events/event-bus'
import { emitAfterCommit, insertOutboxRow } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'
import type {
  CreatePortalCommand,
  DeletePortalCommand,
  PortalCommandStore,
  UpdatePortalCommand,
} from '../application/ports/portal-command-store.port'
import type { Portal, PortalTheme } from '../domain/types'
import { portalError } from '../domain/errors'
import { portalToRow } from './mappers/portal.mapper'

type PortalSetValues = {
  name?: string
  slug?: string
  description?: string | null
  heroImageUrl?: string | null
  theme?: Record<string, unknown>
  privateFeedbackThreshold?: number
  publicationState?: Portal['publicationState']
  updatedAt?: Date
}

const sameInstant = (left: Date, right: Date): boolean =>
  left.getTime() === right.getTime()

function assertCreateCommand(command: CreatePortalCommand): void {
  const { portal, event, responsibilityNeededEvent, initialResponsibleManagerId } =
    command
  if (
    portal.organizationId !== command.organizationId ||
    event.organizationId !== command.organizationId ||
    event.propertyId !== portal.propertyId ||
    event.portalId !== portal.id ||
    event.publicationState !== portal.publicationState ||
    event.sourceAggregateVersion !== portal.updatedAt.toISOString() ||
    !sameInstant(event.occurredAt, portal.createdAt)
  ) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal creation')
  }
  const needsResponsibility = initialResponsibleManagerId === null
  if (
    needsResponsibility !== Boolean(responsibilityNeededEvent) ||
    needsResponsibility !== (portal.responsibilityNeededSince !== null)
  ) {
    throw portalError(
      'revision_conflict',
      'Portal responsibility state and recovery fact must be committed together',
    )
  }
  if (
    initialResponsibleManagerId !== null &&
    portal.createdBy !== initialResponsibleManagerId
  ) {
    throw portalError(
      'responsible_manager_ineligible',
      'initial responsible manager must be the eligible Portal creator',
    )
  }
  if (
    responsibilityNeededEvent &&
    (responsibilityNeededEvent.organizationId !== command.organizationId ||
      responsibilityNeededEvent.propertyId !== portal.propertyId ||
      responsibilityNeededEvent.portalId !== portal.id ||
      !sameInstant(responsibilityNeededEvent.occurredAt, portal.createdAt))
  ) {
    throw portalError(
      'forbidden',
      'Tenant or resource mismatch on Portal responsibility fact',
    )
  }
}

function buildPortalSetClause(patch: Readonly<Partial<Portal>>): PortalSetValues {
  const set: PortalSetValues = {}
  if (patch.updatedAt !== undefined) set.updatedAt = patch.updatedAt
  if (patch.name !== undefined) set.name = patch.name
  if (patch.slug !== undefined) set.slug = patch.slug
  if (patch.description !== undefined) set.description = patch.description
  if (patch.heroImageUrl !== undefined) set.heroImageUrl = patch.heroImageUrl
  if (patch.theme !== undefined)
    set.theme = patch.theme as PortalTheme as Record<string, unknown>
  if (patch.privateFeedbackThreshold !== undefined)
    set.privateFeedbackThreshold = patch.privateFeedbackThreshold
  if (patch.publicationState !== undefined) set.publicationState = patch.publicationState
  return set
}

function assertUpdateCommand(command: UpdatePortalCommand): void {
  const nextPublicationState =
    command.patch.publicationState ?? command.event.previousPublicationState
  if (
    command.event.organizationId !== command.organizationId ||
    command.event.propertyId !== command.propertyId ||
    command.event.portalId !== command.portalId ||
    command.event.publicationState !== nextPublicationState ||
    command.event.sourceAggregateVersion !== command.event.occurredAt.toISOString() ||
    command.patch.updatedAt === undefined ||
    !sameInstant(command.patch.updatedAt, command.event.occurredAt)
  ) {
    throw portalError(
      'forbidden',
      'Tenant, resource, or version mismatch on Portal update',
    )
  }
}

function assertDeleteCommand(command: DeletePortalCommand): void {
  const matches = (event: {
    organizationId: DeletePortalCommand['organizationId']
    propertyId: DeletePortalCommand['propertyId']
    portalId: DeletePortalCommand['portalId']
    occurredAt: Date
  }) =>
    event.organizationId === command.organizationId &&
    event.propertyId === command.propertyId &&
    event.portalId === command.portalId &&
    sameInstant(event.occurredAt, command.at)

  if (
    !matches(command.event) ||
    !matches(command.tokenRevokedEvent) ||
    command.event.sourceAggregateVersion !== command.at.toISOString() ||
    command.reason.trim().length === 0
  ) {
    throw portalError(
      'forbidden',
      'Tenant, resource, or version mismatch on Portal delete',
    )
  }
}

export const createAtomicPortalCommandStore = (
  db: Database,
  events: EventBus,
): PortalCommandStore => {
  return {
    createPortal: async (command) =>
      trace('portal.commandStore.createPortal', async () => {
        assertCreateCommand(command)
        await db.transaction(async (tx) => {
          await tx.insert(portals).values(portalToRow(command.portal))
          if (command.initialResponsibleManagerId) {
            await tx.insert(portalResponsibleManagers).values({
              organizationId: command.organizationId,
              propertyId: command.portal.propertyId,
              portalId: command.portal.id,
              userId: command.initialResponsibleManagerId,
              effectiveFrom: command.portal.createdAt,
              createdBy: command.initialResponsibleManagerId,
            })
          }
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.portal.createdAt,
          })
          if (command.responsibilityNeededEvent) {
            await insertOutboxRow(tx, command.responsibilityNeededEvent, {
              recordedAt: command.portal.createdAt,
            })
          }
        })
        await emitAfterCommit(events, command.event)
        if (command.responsibilityNeededEvent) {
          await emitAfterCommit(events, command.responsibilityNeededEvent)
        }
      }),

    updatePortal: async (command) =>
      trace('portal.commandStore.updatePortal', async () => {
        assertUpdateCommand(command)
        await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(portals)
            .set(buildPortalSetClause(command.patch))
            .where(
              and(
                eq(portals.organizationId, unbrand(command.organizationId)),
                eq(portals.propertyId, unbrand(command.propertyId)),
                eq(portals.id, unbrand(command.portalId)),
                eq(portals.publicationState, command.event.previousPublicationState),
                eq(portals.updatedAt, command.expectedUpdatedAt),
                isNull(portals.deletedAt),
              ),
            )
            .returning({ id: portals.id })
          if (!updated) {
            throw portalError(
              'revision_conflict',
              'Portal changed while the update was being committed',
            )
          }
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.event.occurredAt,
          })
        })
        await emitAfterCommit(events, command.event)
      }),

    deletePortal: async (command) =>
      trace('portal.commandStore.deletePortal', async () => {
        assertDeleteCommand(command)
        const revoked = await db.transaction(async (tx) => {
          const [deleted] = await tx
            .update(portals)
            .set({ deletedAt: command.at, updatedAt: command.at })
            .where(
              and(
                eq(portals.organizationId, unbrand(command.organizationId)),
                eq(portals.propertyId, unbrand(command.propertyId)),
                eq(portals.id, unbrand(command.portalId)),
                eq(portals.updatedAt, command.expectedUpdatedAt),
                isNull(portals.deletedAt),
              ),
            )
            .returning({ id: portals.id })
          if (!deleted) {
            throw portalError(
              'revision_conflict',
              'Portal changed while the delete was being committed',
            )
          }

          const revokedRows = await tx
            .update(portalTokens)
            .set({
              status: 'revoked',
              revokedAt: command.at,
              retiredAt: command.at,
              revokedBy: unbrand(command.revokedBy),
              revokedReason: command.reason.trim(),
              gracePeriodEnds: null,
            })
            .where(
              and(
                eq(portalTokens.organizationId, unbrand(command.organizationId)),
                eq(portalTokens.propertyId, unbrand(command.propertyId)),
                eq(portalTokens.portalId, unbrand(command.portalId)),
                or(
                  eq(portalTokens.status, 'active'),
                  eq(portalTokens.status, 'rotating'),
                ),
              ),
            )
            .returning({ id: portalTokens.id })

          await insertOutboxRow(tx, command.event, { recordedAt: command.at })
          if (revokedRows.length > 0) {
            await insertOutboxRow(tx, command.tokenRevokedEvent, {
              recordedAt: command.at,
            })
          }
          return revokedRows.length
        })

        await emitAfterCommit(events, command.event)
        if (revoked > 0) {
          await emitAfterCommit(events, command.tokenRevokedEvent)
        }
        return { revoked }
      }),
  }
}
