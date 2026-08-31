import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId, unbrand } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { portalError } from '../../domain/errors'
import { portalPublicationRolledBack, portalUpdated } from '../../domain/events'
import { nextPortalCommandAt } from '../portal-command-version'

export type RollbackPortalPublicationDeps = Readonly<{
  portalRepo: PortalRepository
  publicationRepo: PortalPublicationRepository
  commandStore: PortalCommandStore
  staffPublicApi: StaffPublicApi
  idGen: () => string
  clock: () => Date
}>

export const rollbackPortalPublication =
  (deps: RollbackPortalPublicationDeps) =>
  async (
    input: Readonly<{ portalId: string; version: number }>,
    ctx: AuthContext,
  ): Promise<
    Readonly<{
      snapshotId: string
      version: number
      configurationDigest: string
      activatedAt: Date
    }>
  > => {
    if (!Number.isSafeInteger(input.version) || input.version < 1) {
      throw portalError(
        'publication_snapshot_unavailable',
        'Publication version must be a positive integer',
      )
    }
    const pid = portalId(input.portalId)
    const portal = await loadPortalOrThrow(deps, ctx, pid, {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to roll back Portal publication',
    })
    if (portal.publicationState !== 'published') {
      throw portalError(
        'invalid_publication_transition',
        'Only a currently published Portal can roll back to an earlier version',
      )
    }

    const [target, active, cursor] = await Promise.all([
      deps.publicationRepo.findSnapshotByVersion(ctx.organizationId, pid, input.version),
      deps.publicationRepo.findActiveForPortal(ctx.organizationId, pid),
      deps.publicationRepo.getCursor(ctx.organizationId, pid),
    ])
    if (!target || !active || target.version >= active.version) {
      throw portalError(
        'publication_snapshot_unavailable',
        'The requested earlier publication version is unavailable for this Portal',
      )
    }

    const occurredAt = deps.clock()
    const revision = nextPortalCommandAt(occurredAt, portal.updatedAt)
    await deps.commandStore.updatePortal({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: pid,
      actorUserId: ctx.userId,
      expectedUpdatedAt: portal.updatedAt,
      revision,
      occurredAt,
      patch: {},
      publication: {
        kind: 'rollback',
        snapshotId: target.id,
        snapshotVersion: target.version,
        publicationDigest: target.configurationDigest,
        activation: {
          id: deps.idGen(),
          organizationId: unbrand(ctx.organizationId),
          propertyId: unbrand(portal.propertyId),
          portalId: unbrand(pid),
          snapshotId: target.id,
          activationSequence: cursor.nextActivationSequence,
          kind: 'rollback',
          activatedBy: unbrand(ctx.userId),
          activatedAt: occurredAt,
          deactivatedAt: null,
          deactivationReason: null,
        },
      },
      lifecycleEvent: portalPublicationRolledBack({
        organizationId: ctx.organizationId,
        propertyId: portal.propertyId,
        portalId: pid,
        publicationSnapshotId: target.id,
        publicationVersion: target.version,
        publicationDigest: target.configurationDigest,
        userId: ctx.userId,
        sourceAggregateVersion: revision.toISOString(),
        occurredAt,
      }),
      event: portalUpdated({
        portalId: pid,
        organizationId: ctx.organizationId,
        propertyId: portal.propertyId,
        previousPublicationState: 'published',
        publicationState: 'published',
        sourceAggregateVersion: revision.toISOString(),
        occurredAt,
      }),
    })
    return {
      snapshotId: target.id,
      version: target.version,
      configurationDigest: target.configurationDigest,
      activatedAt: occurredAt,
    }
  }

export type RollbackPortalPublication = ReturnType<typeof rollbackPortalPublication>
