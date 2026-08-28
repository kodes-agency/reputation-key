import type { IdentityManagerFactsPublicApi } from '#/contexts/identity/application/public-api'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { OrganizationId, PortalId } from '#/shared/domain/ids'
import { userId } from '#/shared/domain/ids'
import { listEligiblePortalManagers } from '../portal-manager-eligibility'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalResponsibleManagerRepository } from '../ports/portal-responsible-manager.repository'

export type PortalContactRequestManagerAuthorityFacts = Readonly<{
  propertyId: import('#/shared/domain/ids').PropertyId
  creatorUserId: import('#/shared/domain/ids').UserId | null
  responsibleManagerUserIds: readonly import('#/shared/domain/ids').UserId[]
}>

type PortalContactRequestManagerAuthorityDeps = Readonly<{
  portalRepo: Pick<PortalRepository, 'findById'>
  managerRepo: Pick<PortalResponsibleManagerRepository, 'listActive'>
  identityPublicApi: IdentityManagerFactsPublicApi
  staffPublicApi: StaffPublicApi
}>

export const getPortalContactRequestManagerAuthorityFacts =
  (deps: PortalContactRequestManagerAuthorityDeps) =>
  async (
    organizationId: OrganizationId,
    portalId: PortalId,
  ): Promise<PortalContactRequestManagerAuthorityFacts | null> => {
    const portal = await deps.portalRepo.findById(organizationId, portalId)
    if (!portal) return null

    const [assignments, eligibleManagers] = await Promise.all([
      deps.managerRepo.listActive(organizationId, portalId),
      listEligiblePortalManagers(deps, organizationId, portal.propertyId),
    ])
    const eligibleIds = new Set(eligibleManagers.map((manager) => manager.userId))
    return {
      propertyId: portal.propertyId,
      creatorUserId: portal.createdBy,
      responsibleManagerUserIds: assignments
        .filter((assignment) => eligibleIds.has(assignment.userId))
        .map((assignment) => userId(assignment.userId)),
    }
  }
