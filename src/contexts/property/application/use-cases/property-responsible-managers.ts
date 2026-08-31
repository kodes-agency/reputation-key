import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { propertyId } from '#/shared/domain/ids'
import type { EventBus } from '#/shared/events/event-bus'
import type { PropertyRepository } from '../ports/property.repository'
import type { PropertyResponsibleManagerRepository } from '../ports/property-responsible-manager.repository'
import type { PropertyManagerEligibilityDeps } from '../property-manager-eligibility'
import { listEligiblePropertyManagers } from '../property-manager-eligibility'
import { propertyError } from '../../domain/errors'
import { propertyResponsibilityNeeded } from '../../domain/events'

type QueryDeps = PropertyManagerEligibilityDeps &
  Readonly<{
    propertyRepo: PropertyRepository
    managerRepo: PropertyResponsibleManagerRepository
    clock: () => Date
  }>

type CommandDeps = QueryDeps & Readonly<{ events: EventBus }>

async function loadAccessibleProperty(
  deps: QueryDeps,
  rawPropertyId: string,
  ctx: AuthContext,
  permission: 'property.read' | 'property.update',
) {
  if (!canForContext(ctx, permission)) {
    throw propertyError('forbidden', 'this role cannot manage Property responsibility')
  }
  const pid = propertyId(rawPropertyId)
  const property = await deps.propertyRepo.findById(ctx.organizationId, pid)
  if (!property) throw propertyError('property_not_found', 'property not found')
  const accessible = await isPropertyAccessibleForPermission(
    (orgId, userId, organizationWide) =>
      deps.staffPublicApi.getAccessiblePropertyIds(orgId, userId, organizationWide),
    ctx,
    permission,
    pid,
  )
  if (!accessible) throw propertyError('forbidden', 'No access to this property')
  return property
}

export const listPropertyResponsibleManagers =
  (deps: QueryDeps) =>
  async (input: Readonly<{ propertyId: string }>, ctx: AuthContext) => {
    const property = await loadAccessibleProperty(
      deps,
      input.propertyId,
      ctx,
      'property.read',
    )
    const [assignments, eligibleManagers] = await Promise.all([
      deps.managerRepo.listActive(ctx.organizationId, property.id),
      listEligiblePropertyManagers(deps, ctx.organizationId, property.id),
    ])
    return {
      assignments,
      eligibleManagers,
      revision: property.responsibleManagerRevision,
      responsibilityNeeded: assignments.length === 0,
      responsibilityNeededSince: property.responsibilityNeededSince,
    } as const
  }

export const updatePropertyResponsibleManagers =
  (deps: CommandDeps) =>
  async (
    input: Readonly<{
      propertyId: string
      managerUserIds: readonly string[]
      expectedRevision: number
    }>,
    ctx: AuthContext,
  ) => {
    const property = await loadAccessibleProperty(
      deps,
      input.propertyId,
      ctx,
      'property.update',
    )
    const managerUserIds = [...new Set(input.managerUserIds)]
    if (managerUserIds.length !== input.managerUserIds.length) {
      throw propertyError(
        'responsible_manager_ineligible',
        'responsible manager selection contains duplicates',
      )
    }
    const eligibleManagers = await listEligiblePropertyManagers(
      deps,
      ctx.organizationId,
      property.id,
    )
    const eligibleIds = new Set(eligibleManagers.map((manager) => manager.userId))
    if (managerUserIds.some((userId) => !eligibleIds.has(userId))) {
      throw propertyError(
        'responsible_manager_ineligible',
        'one or more selected managers are no longer eligible',
      )
    }
    const at = deps.clock()
    const responsibilityNeededEvent = propertyResponsibilityNeeded({
      organizationId: property.organizationId,
      propertyId: property.id,
      occurredAt: at,
    })
    const updated = await deps.managerRepo.replace({
      organizationId: ctx.organizationId,
      propertyId: property.id,
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
