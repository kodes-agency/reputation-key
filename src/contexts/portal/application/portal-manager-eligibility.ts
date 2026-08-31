import type {
  IdentityManagerFactsPublicApi,
  ManagerMembership,
} from '#/contexts/identity/application/public-api'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  isEligibleResponsibleManager,
  listEligibleResponsibleManagers,
} from '#/shared/responsible-manager-eligibility'

export type PortalManagerEligibilityDeps = Readonly<{
  identityPublicApi: IdentityManagerFactsPublicApi
  staffPublicApi: StaffPublicApi
}>

export async function listEligiblePortalManagers(
  deps: PortalManagerEligibilityDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
): Promise<readonly ManagerMembership[]> {
  return listEligibleResponsibleManagers(
    {
      listActiveManagers: deps.identityPublicApi.listActiveManagers,
      getAccessiblePropertyIds: deps.staffPublicApi.getAccessiblePropertyIds,
      findActiveParticipation: async (orgId, pid, managerId) =>
        deps.staffPublicApi.findActiveParticipation?.(orgId, pid, managerId) ?? null,
    },
    organizationId,
    propertyId,
  )
}

export async function isEligiblePortalManager(
  deps: PortalManagerEligibilityDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  userId: string,
): Promise<boolean> {
  return isEligibleResponsibleManager(
    {
      listActiveManagers: deps.identityPublicApi.listActiveManagers,
      getAccessiblePropertyIds: deps.staffPublicApi.getAccessiblePropertyIds,
      findActiveParticipation: async (orgId, pid, managerId) =>
        deps.staffPublicApi.findActiveParticipation?.(orgId, pid, managerId) ?? null,
    },
    organizationId,
    propertyId,
    userId,
  )
}
