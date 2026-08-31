import type { IdentityManagerFactsPublicApi } from '#/contexts/identity/application/public-api'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import {
  isEligibleResponsibleManager,
  listEligibleResponsibleManagers,
} from '#/shared/responsible-manager-eligibility'
import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'

export type PropertyManagerEligibilityDeps = Readonly<{
  identityPublicApi: IdentityManagerFactsPublicApi
  staffPublicApi: StaffPublicApi
}>

const policyDeps = (deps: PropertyManagerEligibilityDeps) => ({
  listActiveManagers: deps.identityPublicApi.listActiveManagers,
  getAccessiblePropertyIds: deps.staffPublicApi.getAccessiblePropertyIds,
  findActiveParticipation: async (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    userId: UserId,
  ) =>
    deps.staffPublicApi.findActiveParticipation?.(organizationId, propertyId, userId) ??
    null,
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
