import type {
  IdentityManagerFactsPublicApi,
  ManagerMembership,
} from '#/contexts/identity/application/public-api'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  isEligibleResponsibleManager,
  listEligibleResponsibleManagers,
  listIneligibleResponsibleManagers,
} from '#/shared/responsible-manager-eligibility'

export type PortalManagerEligibilityDeps = Readonly<{
  identityPublicApi: IdentityManagerFactsPublicApi
  staffPublicApi: StaffPublicApi
}>

/** This context's Identity facts as the shared eligibility policy reads them. */
export const policyDeps = (deps: PortalManagerEligibilityDeps) => ({
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

/**
 * Of these users, those who are not an eligible manager now. A Portal's
 * managers are judged by the Property it belongs to.
 */
export async function listIneligiblePortalManagers(
  deps: PortalManagerEligibilityDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  userIds: readonly string[],
): Promise<readonly string[]> {
  return listIneligibleResponsibleManagers(
    policyDeps(deps),
    organizationId,
    propertyId,
    userIds,
  )
}
