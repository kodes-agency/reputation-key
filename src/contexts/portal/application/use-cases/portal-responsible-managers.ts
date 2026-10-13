import type { AuthContext } from '#/shared/domain/auth-context'
import { strictlyAfter } from '#/shared/domain/clock'
import { portalId } from '#/shared/domain/ids'
import { MANAGER_BECAME_INELIGIBLE_END_REASON } from '#/shared/responsible-manager-eligibility'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalResponsibleManagerRepository } from '../ports/portal-responsible-manager.repository'
import type { PortalManagerEligibilityDeps } from '../portal-manager-eligibility'
import {
  listEligiblePortalManagers,
  listIneligiblePortalManagers,
} from '../portal-manager-eligibility'
import { loadPortalOrThrow } from '../load-accessible-portal'
import type { Portal } from '../../domain/types'
import { portalError } from '../../domain/errors'

type QueryDeps = PortalManagerEligibilityDeps &
  Readonly<{
    portalRepo: PortalRepository
    managerRepo: PortalResponsibleManagerRepository
    clock: () => Date
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

const noLongerEligible = () =>
  portalError(
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
  portal: Portal,
  managerUserIds: readonly string[],
  assignedAt: Date,
): Promise<readonly string[]> {
  const lost = await listIneligiblePortalManagers(
    deps,
    portal.organizationId,
    portal.propertyId,
    managerUserIds,
  )
  if (lost.length === 0) return lost
  const at = strictlyAfter(assignedAt, deps.clock())
  // One at a time: each release takes the Portal's row lock.
  for (const userId of lost) {
    await deps.managerRepo.releaseForUser({
      organizationId: portal.organizationId,
      userId,
      portalIds: [portal.id],
      at,
      endReason: MANAGER_BECAME_INELIGIBLE_END_REASON,
      actorId: null,
    })
  }
  return lost
}

export const updatePortalResponsibleManagers =
  (deps: QueryDeps) =>
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
    const ineligible = await listIneligiblePortalManagers(
      deps,
      ctx.organizationId,
      portal.propertyId,
      managerUserIds,
    )
    if (ineligible.length > 0) throw noLongerEligible()
    const at = deps.clock()
    const updated = await deps.managerRepo.replace({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      managerUserIds,
      expectedRevision: input.expectedRevision,
      actorId: ctx.userId,
      at,
    })
    const released = await releaseAssignedNoLongerEligible(
      deps,
      portal,
      managerUserIds,
      at,
    )
    if (released.length > 0) throw noLongerEligible()
    return {
      assignments: updated.assignments,
      revision: updated.revision,
      becameResponsibilityNeeded: updated.becameResponsibilityNeeded,
    } as const
  }
