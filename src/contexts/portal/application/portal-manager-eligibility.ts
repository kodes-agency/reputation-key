import type {
  IdentityPublicApi,
  ManagerMembership,
} from '#/contexts/identity/application/public-api'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { propertyId as toPropertyId, userId as toUserId } from '#/shared/domain/ids'

export type PortalManagerEligibilityDeps = Readonly<{
  identityPublicApi: IdentityPublicApi
  staffPublicApi: StaffPublicApi
}>

export async function listEligiblePortalManagers(
  deps: PortalManagerEligibilityDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
): Promise<readonly ManagerMembership[]> {
  const memberships = await deps.identityPublicApi.listActiveManagers(organizationId)
  const eligible = await Promise.all(
    memberships.map(async (membership) => {
      if (membership.role === 'AccountAdmin') return membership
      const managerId = toUserId(membership.userId)
      const accessible = await deps.staffPublicApi.getAccessiblePropertyIds(
        organizationId,
        managerId,
        false,
      )
      if (!accessible?.includes(toPropertyId(propertyId))) return null
      const participation = await deps.staffPublicApi.findActiveParticipation?.(
        organizationId,
        propertyId,
        managerId,
      )
      return participation ? membership : null
    }),
  )
  return eligible.filter((membership): membership is ManagerMembership => !!membership)
}

export async function isEligiblePortalManager(
  deps: PortalManagerEligibilityDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  userId: string,
): Promise<boolean> {
  const eligible = await listEligiblePortalManagers(deps, organizationId, propertyId)
  return eligible.some((membership) => membership.userId === userId)
}
