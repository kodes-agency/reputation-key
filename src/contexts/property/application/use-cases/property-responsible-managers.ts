import type { AuthContext } from '#/shared/domain/auth-context'
import { strictlyAfter } from '#/shared/domain/clock'
import { canForContext } from '#/shared/domain/permissions'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { propertyId } from '#/shared/domain/ids'
import { MANAGER_BECAME_INELIGIBLE_END_REASON } from '#/shared/responsible-manager-eligibility'
import type { PropertyRepository } from '../ports/property.repository'
import type { PropertyResponsibleManagerRepository } from '../ports/property-responsible-manager.repository'
import type { PropertyManagerEligibilityDeps } from '../property-manager-eligibility'
import {
  listEligiblePropertyManagers,
  listIneligiblePropertyManagers,
} from '../property-manager-eligibility'
import type { Property } from '../../domain/types'
import { propertyError } from '../../domain/errors'
import { propertyResponsibilityNeeded } from '../../domain/events'

type QueryDeps = PropertyManagerEligibilityDeps &
  Readonly<{
    propertyRepo: PropertyRepository
    managerRepo: PropertyResponsibleManagerRepository
    clock: () => Date
  }>

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

const noLongerEligible = () =>
  propertyError(
    'responsible_manager_ineligible',
    'one or more selected managers are no longer eligible',
  )

/**
 * The second eligibility read of a save, made once the assignment has
 * committed.
 *
 * The first is made before `replace` opens its transaction. A manager whose
 * removal, role change or lost access commits in between is assigned all the
 * same, and the release that change makes (before the membership delete, and
 * again from its fact) may already have run and found nothing to end. Reading
 * again after the commit closes that: whichever of the two commits second is
 * followed by a check that sees the other.
 *
 * Whoever is no longer eligible is released, with the gap recorded and
 * announced as for any release, and named in the answer so that the save is
 * refused as it would have been a moment later. Nobody chose this gap, so
 * nobody is left out of its notice.
 */
async function releaseAssignedNoLongerEligible(
  deps: QueryDeps,
  property: Property,
  managerUserIds: readonly string[],
  assignedAt: Date,
): Promise<readonly string[]> {
  const lost = await listIneligiblePropertyManagers(
    deps,
    property.organizationId,
    property.id,
    managerUserIds,
  )
  if (lost.length === 0) return lost
  const at = strictlyAfter(assignedAt, deps.clock())
  // One at a time: each release takes the Property's row lock.
  for (const userId of lost) {
    await deps.managerRepo.releaseForUser({
      organizationId: property.organizationId,
      userId,
      propertyIds: [property.id],
      at,
      endReason: MANAGER_BECAME_INELIGIBLE_END_REASON,
      actorId: null,
    })
  }
  return lost
}

export const updatePropertyResponsibleManagers =
  (deps: QueryDeps) =>
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
    const ineligible = await listIneligiblePropertyManagers(
      deps,
      ctx.organizationId,
      property.id,
      managerUserIds,
    )
    if (ineligible.length > 0) throw noLongerEligible()
    const at = deps.clock()
    const responsibilityNeededEvent = propertyResponsibilityNeeded({
      organizationId: property.organizationId,
      propertyId: property.id,
      // The admin clearing the list opened the gap; the fan-out drops them.
      actorUserId: ctx.userId,
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
    const released = await releaseAssignedNoLongerEligible(
      deps,
      property,
      managerUserIds,
      at,
    )
    if (released.length > 0) throw noLongerEligible()
    return updated
  }
