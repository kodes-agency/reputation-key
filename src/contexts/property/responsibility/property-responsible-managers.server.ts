import type { AuthContext } from '#/shared/domain/auth-context'
import { strictlyAfter } from '#/shared/domain/clock'
import {
  listEligibleResponsibleManagers,
  listIneligibleResponsibleManagers,
  MANAGER_BECAME_INELIGIBLE_END_REASON,
} from '#/shared/responsible-manager/responsible-manager-eligibility'
import type { PropertyRepository } from '../profile/property-repository.port.server'
import { loadAccessibleProperty } from '../profile/load-accessible-property.server'
import type { PropertyResponsibleManagerRepository } from './manager-repository.port.server'
import type { PropertyManagerEligibilityDeps } from './property-manager-eligibility.server'
import { policyDeps } from './property-manager-eligibility.server'
import type { Property } from '../domain/types'
import { propertyError } from '../domain/errors'
import { propertyResponsibilityNeeded } from '../domain/events'

type QueryDeps = PropertyManagerEligibilityDeps &
  Readonly<{
    propertyRepo: PropertyRepository
    managerRepo: PropertyResponsibleManagerRepository
    clock: () => Date
  }>

const RESPONSIBILITY_DENIED = 'this role cannot manage Property responsibility'

export const listPropertyResponsibleManagers =
  (deps: QueryDeps) =>
  async (input: Readonly<{ propertyId: string }>, ctx: AuthContext) => {
    const property = await loadAccessibleProperty(
      deps,
      input.propertyId,
      ctx,
      'property.read',
      RESPONSIBILITY_DENIED,
    )
    const [assignments, eligibleManagers] = await Promise.all([
      deps.managerRepo.listActive(ctx.organizationId, property.id),
      listEligibleResponsibleManagers(policyDeps(deps), ctx.organizationId, property.id),
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
  const lost = await listIneligibleResponsibleManagers(
    policyDeps(deps),
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
      RESPONSIBILITY_DENIED,
    )
    const managerUserIds = [...new Set(input.managerUserIds)]
    if (managerUserIds.length !== input.managerUserIds.length) {
      throw propertyError(
        'responsible_manager_ineligible',
        'responsible manager selection contains duplicates',
      )
    }
    const ineligible = await listIneligibleResponsibleManagers(
      policyDeps(deps),
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
