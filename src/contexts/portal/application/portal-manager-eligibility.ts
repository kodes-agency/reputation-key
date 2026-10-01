import type {
  IdentityManagerFactsPublicApi,
  ManagerMembership,
} from '#/contexts/identity/application/public-api'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  isEligibleResponsibleManager,
  listEligibleResponsibleManagers,
} from '#/shared/responsible-manager-eligibility'

export type PortalManagerEligibilityDeps = Readonly<{
  identityPublicApi: IdentityManagerFactsPublicApi
  staffPublicApi: StaffPublicApi
}>

const policyDeps = (deps: PortalManagerEligibilityDeps) => ({
  listActiveManagers: deps.identityPublicApi.listActiveManagers,
  getAccessiblePropertyIds: deps.staffPublicApi.getAccessiblePropertyIds,
})

export async function listEligiblePortalManagers(
  deps: PortalManagerEligibilityDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
): Promise<readonly ManagerMembership[]> {
  return listEligibleResponsibleManagers(policyDeps(deps), organizationId, propertyId)
}

export async function isEligiblePortalManager(
  deps: PortalManagerEligibilityDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  userId: string,
): Promise<boolean> {
  return isEligibleResponsibleManager(
    policyDeps(deps),
    organizationId,
    propertyId,
    userId,
  )
}
