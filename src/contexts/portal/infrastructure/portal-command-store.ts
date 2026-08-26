// Atomic Portal command store (ARC-01).
//
// Portal state, responsibility/token side effects, and every required durable
// lifecycle fact commit in one PostgreSQL transaction. The EventBus is only a
// post-commit acceleration path; the outbox remains the recovery authority.

import { and, eq, gte, isNull, lt, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalPublicationActivations,
  portalPublicationSnapshots,
  portalLinkCategories,
  portalLinks,
  portalResponsibleManagers,
  portals,
  portalTokens,
} from '#/shared/db/schema/portal.schema'
import { portalGroups } from '#/shared/db/schema/portal-group.schema'
import { portalGroupMemberships } from '#/shared/db/schema/people-access.schema'
import type { EventBus } from '#/shared/events/event-bus'
import { emitAfterCommit, insertOutboxRow } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'
import type {
  CreatePortalCommand,
  DeletePortalCommand,
  DeletePortalGroupCommand,
  PortalCommandStore,
  UpdatePortalCommand,
} from '../application/ports/portal-command-store.port'
import type { Portal, PortalTheme } from '../domain/types'
import { portalError } from '../domain/errors'
import { portalToRow } from './mappers/portal.mapper'
import { verifyPortalPublicationSnapshot } from '../application/portal-publication-snapshot'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'

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

  const previous = command.event.previousPublicationState
  const next = command.event.publicationState
  const publication = command.publication
  if (
    next === 'published' &&
    previous !== 'published' &&
    publication?.kind !== 'publish'
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'A new immutable snapshot is required before publishing',
    )
  }
  if (
    previous === 'published' &&
    (next === 'disabled' || next === 'archived') &&
    (publication?.kind !== 'deactivate' || publication.reason !== next)
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'The active publication must close with the Portal state transition',
    )
  }
  if (publication?.kind === 'publish') {
    const { snapshot, activation } = publication
    if (
      previous === 'published' ||
      next !== 'published' ||
      snapshot.organizationId !== unbrand(command.organizationId) ||
      snapshot.propertyId !== unbrand(command.propertyId) ||
      snapshot.portalId !== unbrand(command.portalId) ||
      activation.organizationId !== snapshot.organizationId ||
      activation.propertyId !== snapshot.propertyId ||
      activation.portalId !== snapshot.portalId ||
      activation.snapshotId !== snapshot.id ||
      activation.deactivatedAt !== null ||
      activation.deactivationReason !== null ||
      activation.activatedBy !== snapshot.createdBy ||
      !verifyPortalPublicationSnapshot(snapshot) ||
      !sameInstant(snapshot.createdAt, command.event.occurredAt) ||
      !sameInstant(activation.activatedAt, command.event.occurredAt)
    ) {
      throw portalError(
        'publication_snapshot_unavailable',
        'Publication snapshot, activation, and Portal state do not share one scope',
      )
    }
  }
  if (publication?.kind === 'rollback') {
    const { activation } = publication
    if (
      previous !== 'published' ||
      next !== 'published' ||
      publication.snapshotId !== activation.snapshotId ||
      publication.snapshotVersion < 1 ||
      activation.organizationId !== unbrand(command.organizationId) ||
      activation.propertyId !== unbrand(command.propertyId) ||
      activation.portalId !== unbrand(command.portalId) ||
      activation.deactivatedAt !== null ||
      activation.deactivationReason !== null ||
      !sameInstant(activation.activatedAt, command.event.occurredAt)
    ) {
      throw portalError(
        'publication_snapshot_unavailable',
        'Rollback activation does not match the current Portal scope',
      )
    }
  }
  if (
    publication?.kind === 'deactivate' &&
    (!sameInstant(publication.at, command.event.occurredAt) ||
      previous !== 'published' ||
      next === 'published')
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Publication deactivation does not match the Portal state transition',
    )
  }
}

async function assertSnapshotMatchesCommittedWorkingCopy(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  command: UpdatePortalCommand &
    Readonly<{
      publication: Extract<
        NonNullable<UpdatePortalCommand['publication']>,
        Readonly<{ kind: 'publish' }>
      >
    }>,
): Promise<void> {
  const [portal] = await tx
    .select()
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
      'publication_snapshot_unavailable',
      'Portal disappeared while its publication snapshot was being committed',
    )
  }
  const organizationResult = await tx.execute(
    sql`SELECT name FROM "organization" WHERE id = ${unbrand(command.organizationId)} LIMIT 1 FOR SHARE`,
  )
  const categories = await tx
    .select()
    .from(portalLinkCategories)
    .where(
      and(
        eq(portalLinkCategories.organizationId, unbrand(command.organizationId)),
        eq(portalLinkCategories.portalId, unbrand(command.portalId)),
      ),
    )
    .orderBy(portalLinkCategories.sortKey, portalLinkCategories.id)
  const links = await tx
    .select()
    .from(portalLinks)
    .where(
      and(
        eq(portalLinks.organizationId, unbrand(command.organizationId)),
        eq(portalLinks.portalId, unbrand(command.portalId)),
      ),
    )
    .orderBy(portalLinks.sortKey, portalLinks.id)
  const organization = organizationResult.rows[0] as { name?: unknown } | undefined
  if (!organization || typeof organization.name !== 'string') {
    throw portalError(
      'publication_snapshot_unavailable',
      'Portal organization display content is unavailable',
    )
  }

  const committed = {
    portal: {
      id: portal.id,
      name: portal.name,
      slug: portal.slug,
      description: portal.description,
      heroImageUrl: portal.heroImageUrl,
      theme: portal.theme,
      organizationName: organization.name,
    },
    categories: categories.map((category) => ({
      id: category.id,
      title: category.title,
      sortKey: category.sortKey,
    })),
    links: links.map((link) => ({
      id: link.id,
      label: link.label,
      url: link.url,
      categoryId: link.categoryId,
      sortKey: link.sortKey,
    })),
    privateFeedbackThreshold: portal.privateFeedbackThreshold,
  }
  const approved = command.publication.snapshot.configuration
  const snapshotted = {
    portal: approved.portal,
    categories: approved.categories,
    links: approved.links,
    privateFeedbackThreshold: approved.reviewGateway.privateFeedbackThreshold,
  }
  if (canonicalizeRfc8785(committed) !== canonicalizeRfc8785(snapshotted)) {
    throw portalError(
      'revision_conflict',
      'Portal content changed while the publication snapshot was being committed',
    )
  }
}

function snapshotToRow(
  snapshot: import('../domain/portal-publication-snapshot').PortalPublicationSnapshot,
) {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    propertyId: snapshot.propertyId,
    portalId: snapshot.portalId,
    version: snapshot.version,
    configurationDigest: snapshot.configurationDigest,
    configuration: snapshot.configuration,
    guestLocale: snapshot.configuration.guestLocale,
    languagePackVersion: snapshot.configuration.languagePackVersion,
    privateFeedbackThreshold:
      snapshot.configuration.reviewGateway.privateFeedbackThreshold,
    destinationUri: snapshot.destinationUri,
    destinationRetrievedAt: snapshot.destinationRetrievedAt,
    destinationSourceEpoch: snapshot.destinationSourceEpoch,
    destinationProfileVersion: snapshot.destinationProfileVersion,
    createdBy: snapshot.createdBy,
    createdAt: snapshot.createdAt,
  } satisfies typeof portalPublicationSnapshots.$inferInsert
}

function activationToRow(
  activation: import('../domain/portal-publication-snapshot').PortalPublicationActivation,
) {
  return {
    id: activation.id,
    organizationId: activation.organizationId,
    propertyId: activation.propertyId,
    portalId: activation.portalId,
    snapshotId: activation.snapshotId,
    activationSequence: activation.activationSequence,
    kind: activation.kind,
    activatedBy: activation.activatedBy,
    activatedAt: activation.activatedAt,
    deactivatedAt: activation.deactivatedAt,
    deactivationReason: activation.deactivationReason,
  } satisfies typeof portalPublicationActivations.$inferInsert
}

async function closeActivePublication(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  command: UpdatePortalCommand,
  reason: 'disabled' | 'archived' | 'replaced',
): Promise<number> {
  const closed = await tx
    .update(portalPublicationActivations)
    .set({
      deactivatedAt: command.event.occurredAt,
      deactivationReason: reason,
    })
    .where(
      and(
        eq(portalPublicationActivations.organizationId, unbrand(command.organizationId)),
        eq(portalPublicationActivations.propertyId, unbrand(command.propertyId)),
        eq(portalPublicationActivations.portalId, unbrand(command.portalId)),
        isNull(portalPublicationActivations.deactivatedAt),
      ),
    )
    .returning({ id: portalPublicationActivations.id })
  return closed.length
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

function assertDeletePortalGroupCommand(command: DeletePortalGroupCommand): void {
  const { event } = command
  if (
    event.organizationId !== command.organizationId ||
    event.propertyId !== command.propertyId ||
    event.portalGroupId !== command.portalGroupId ||
    !sameInstant(event.occurredAt, command.at)
  ) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal Group delete')
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
          if (command.publication?.kind === 'publish') {
            // Publication is rare and safety-sensitive. This bounded table lock
            // prevents link/category writers from crossing the snapshot read;
            // the post-update comparison then rejects any working copy that
            // changed before the lock was acquired.
            await tx.execute(
              sql`LOCK TABLE ${portalLinkCategories}, ${portalLinks} IN SHARE ROW EXCLUSIVE MODE`,
            )
          }
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

          if (command.publication?.kind === 'publish') {
            await assertSnapshotMatchesCommittedWorkingCopy(
              tx,
              command as UpdatePortalCommand & {
                publication: Extract<
                  NonNullable<UpdatePortalCommand['publication']>,
                  { kind: 'publish' }
                >
              },
            )
            const unexpectedlyActive = await closeActivePublication(
              tx,
              command,
              'replaced',
            )
            if (unexpectedlyActive !== 0) {
              throw portalError(
                'revision_conflict',
                'A non-published Portal unexpectedly retained an active publication',
              )
            }
            await tx
              .insert(portalPublicationSnapshots)
              .values(snapshotToRow(command.publication.snapshot))
            await tx
              .insert(portalPublicationActivations)
              .values(activationToRow(command.publication.activation))
          } else if (command.publication?.kind === 'rollback') {
            const [target] = await tx
              .select({ id: portalPublicationSnapshots.id })
              .from(portalPublicationSnapshots)
              .where(
                and(
                  eq(
                    portalPublicationSnapshots.organizationId,
                    unbrand(command.organizationId),
                  ),
                  eq(portalPublicationSnapshots.propertyId, unbrand(command.propertyId)),
                  eq(portalPublicationSnapshots.portalId, unbrand(command.portalId)),
                  eq(portalPublicationSnapshots.id, command.publication.snapshotId),
                  eq(
                    portalPublicationSnapshots.version,
                    command.publication.snapshotVersion,
                  ),
                ),
              )
              .limit(1)
            if (!target) {
              throw portalError(
                'publication_snapshot_unavailable',
                'The requested rollback snapshot does not belong to this Portal',
              )
            }
            const closed = await closeActivePublication(tx, command, 'replaced')
            if (closed !== 1) {
              throw portalError(
                'revision_conflict',
                'Rollback requires exactly one active Portal publication',
              )
            }
            await tx
              .insert(portalPublicationActivations)
              .values(activationToRow(command.publication.activation))
          } else if (command.publication?.kind === 'deactivate') {
            // Legacy published rows can have no activation during the expand
            // migration. They must still be safely disable-able. More than one
            // is impossible under the partial unique index.
            await closeActivePublication(tx, command, command.publication.reason)
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

    deletePortalGroup: async (command) =>
      trace('portal.commandStore.deletePortalGroup', async () => {
        assertDeletePortalGroupCommand(command)
        await db.transaction(async (tx) => {
          const [deleted] = await tx
            .update(portalGroups)
            .set({ deletedAt: command.at, updatedAt: command.at })
            .where(
              and(
                eq(portalGroups.organizationId, unbrand(command.organizationId)),
                eq(portalGroups.propertyId, unbrand(command.propertyId)),
                eq(portalGroups.id, unbrand(command.portalGroupId)),
                eq(portalGroups.updatedAt, command.expectedUpdatedAt),
                isNull(portalGroups.deletedAt),
              ),
            )
            .returning({ id: portalGroups.id })
          if (!deleted) {
            throw portalError(
              'revision_conflict',
              'Portal Group changed while the delete was being committed',
            )
          }

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
                gte(portalGroupMemberships.effectiveFrom, command.at),
              ),
            )
          await tx
            .update(portalGroupMemberships)
            .set({ effectiveTo: command.at, endReason: 'group_archived' })
            .where(
              and(
                ...membershipScope,
                lt(portalGroupMemberships.effectiveFrom, command.at),
              ),
            )

          await insertOutboxRow(tx, command.event, { recordedAt: command.at })
        })
        await emitAfterCommit(events, command.event)
      }),
  }
}
