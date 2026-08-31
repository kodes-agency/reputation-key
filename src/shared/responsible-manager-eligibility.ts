import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import { userId as toUserId } from '#/shared/domain/ids'

/**
 * Shared selection policy for workflow-notification responsibility.
 *
 * Access, participation, and responsibility remain independent authorities:
 * this policy decides only who may be explicitly selected. It never grants
 * access or creates an assignment.
 */
export type ResponsibleManagerMembership = Readonly<{
  userId: string
  role: 'AccountAdmin' | 'PropertyManager'
  propertyAccessScope: 'organization' | 'assigned-properties'
}>

export type ResponsibleManagerEligibilityDeps = Readonly<{
  listActiveManagers: (
    organizationId: string,
  ) => Promise<readonly ResponsibleManagerMembership[]>
  getAccessiblePropertyIds: (
    organizationId: OrganizationId,
    userId: UserId,
    organizationWide: boolean,
  ) => Promise<readonly PropertyId[] | null>
  findActiveParticipation: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    userId: UserId,
  ) => Promise<unknown | null>
}>

export async function listEligibleResponsibleManagers(
  deps: ResponsibleManagerEligibilityDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
): Promise<readonly ResponsibleManagerMembership[]> {
  const memberships = await deps.listActiveManagers(organizationId)
  const eligible = await Promise.all(
    memberships.map(async (membership) => {
      if (membership.propertyAccessScope === 'organization') return membership
      const managerId = toUserId(membership.userId)
      const accessible = await deps.getAccessiblePropertyIds(
        organizationId,
        managerId,
        false,
      )
      if (!accessible?.includes(propertyId)) return null
      const participation = await deps.findActiveParticipation(
        organizationId,
        propertyId,
        managerId,
      )
      return participation ? membership : null
    }),
  )
  return eligible.filter(
    (membership): membership is ResponsibleManagerMembership => !!membership,
  )
}

export async function isEligibleResponsibleManager(
  deps: ResponsibleManagerEligibilityDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  userId: string,
): Promise<boolean> {
  const eligible = await listEligibleResponsibleManagers(deps, organizationId, propertyId)
  return eligible.some((membership) => membership.userId === userId)
}
