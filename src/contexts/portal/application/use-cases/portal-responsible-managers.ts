import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalResponsibleManagerRepository } from '../ports/portal-responsible-manager.repository'
import type { PortalManagerEligibilityDeps } from '../portal-manager-eligibility'
import { listEligiblePortalManagers } from '../portal-manager-eligibility'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { portalError } from '../../domain/errors'
import type { EventBus } from '#/shared/events/event-bus'
import { portalResponsibilityNeeded } from '../../domain/events'

type QueryDeps = PortalManagerEligibilityDeps &
  Readonly<{
    portalRepo: PortalRepository
    managerRepo: PortalResponsibleManagerRepository
    clock: () => Date
  }>

type CommandDeps = QueryDeps &
  Readonly<{
    events: EventBus
  }>

export const listPortalResponsibleManagers =
  (deps: QueryDeps) =>
  async (input: Readonly<{ portalId: string }>, ctx: AuthContext) => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.read',
      forbiddenMessage: 'this role cannot view responsible managers',
    })
    const [assignments, eligibleManagers] = await Promise.all([
      deps.managerRepo.listActive(ctx.organizationId, portal.id),
      listEligiblePortalManagers(deps, ctx.organizationId, portal.propertyId),
    ])
    return {
      assignments,
      eligibleManagers,
      revision: portal.responsibleManagerRevision,
      responsibilityNeeded: assignments.length === 0,
      responsibilityNeededSince: portal.responsibilityNeededSince,
    } as const
  }

export const updatePortalResponsibleManagers =
  (deps: CommandDeps) =>
  async (
    input: Readonly<{
      portalId: string
      managerUserIds: readonly string[]
      expectedRevision: number
    }>,
    ctx: AuthContext,
  ) => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'this role cannot manage responsible managers',
    })
    if (portal.publicationState === 'archived') {
      throw portalError('portal_inactive', 'archived portal responsibility is read-only')
    }
    const managerUserIds = [...new Set(input.managerUserIds)]
    if (managerUserIds.length !== input.managerUserIds.length) {
      throw portalError(
        'responsible_manager_ineligible',
        'responsible manager selection contains duplicates',
      )
    }
    const eligibleManagers = await listEligiblePortalManagers(
      deps,
      ctx.organizationId,
      portal.propertyId,
    )
    const eligibleIds = new Set(eligibleManagers.map((manager) => manager.userId))
    const ineligible = managerUserIds.find((userId) => !eligibleIds.has(userId))
    if (ineligible) {
      throw portalError(
        'responsible_manager_ineligible',
        'one or more selected managers are no longer eligible',
      )
    }
    const at = deps.clock()
    const responsibilityNeededEvent = portalResponsibilityNeeded({
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      occurredAt: at,
    })
    const updated = await deps.managerRepo.replace({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      managerUserIds,
      expectedRevision: input.expectedRevision,
      actorId: ctx.userId,
      at,
      responsibilityNeededEvent,
    })
    if (updated.becameResponsibilityNeeded) {
      await deps.events.emit(responsibilityNeededEvent)
    }
    return updated
  }
