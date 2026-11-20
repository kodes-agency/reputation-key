import type { IdentityManagerFactsPublicApi } from '#/contexts/identity/application/public-api'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import {
  isEligibleResponsibleManager,
  listEligibleResponsibleManagers,
  listIneligibleResponsibleManagers,
} from '#/shared/responsible-manager-eligibility'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type PropertyManagerEligibilityDeps = Readonly<{
  identityPublicApi: IdentityManagerFactsPublicApi
  staffPublicApi: StaffPublicApi
}>

/** This context's Identity facts as the shared eligibility policy reads them. */
export const policyDeps = (deps: PropertyManagerEligibilityDeps) => ({
  listActiveManagers: deps.identityPublicApi.listActiveManagers,
  getAccessiblePropertyIds: deps.staffPublicApi.getAccessiblePropertyIds,
})

export const listEligiblePropertyManagers = (
  deps: PropertyManagerEligibilityDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
) => listEligibleResponsibleManagers(policyDeps(deps), organizationId, propertyId)

export const isEligiblePropertyManager = (
  deps: PropertyManagerEligibilityDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  userId: string,
) => isEligibleResponsibleManager(policyDeps(deps), organizationId, propertyId, userId)

/** Of these users, those who are not an eligible manager of the Property now. */
export const listIneligiblePropertyManagers = (
  deps: PropertyManagerEligibilityDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  userIds: readonly string[],
) =>
  listIneligibleResponsibleManagers(policyDeps(deps), organizationId, propertyId, userIds)
