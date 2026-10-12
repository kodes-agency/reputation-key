import type { PropertyFactsPublicApi } from '#/contexts/property/application/public-api'
import type {
  PortalGroupPublicApi,
  PortalPublicApi,
} from '#/contexts/portal/application/public-api'
import {
  organizationId as toOrganizationId,
  portalGroupId as toPortalGroupId,
  portalId as toPortalId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import type { GoalSubjectNameReader } from '../../application/use-cases/goal-bulk-create'
import type { GoalProgramSubjectReader } from '../../application/use-cases/goal-programs'

/** Cross-context, tenant-bound subject validation for canonical Goal Programs. */
export const createGoalProgramSubjectReader = (
  propertyApi: PropertyFactsPublicApi,
  portalApi: PortalPublicApi,
  portalGroupApi: PortalGroupPublicApi,
): GoalProgramSubjectReader & GoalSubjectNameReader => {
  /** The Portal when it is a current Portal of the Property; archived ones are not. */
  const currentPortal = async (
    organizationId: string,
    propertyId: string,
    portalId: string,
  ) => {
    const brandedPortalId = toPortalId(portalId)
    const [context, portal] = await Promise.all([
      portalApi.resolvePortalContext(brandedPortalId),
      portalApi.getPortalInfo(toOrganizationId(organizationId), brandedPortalId),
    ])
    return context?.organizationId === organizationId &&
      context.propertyId === propertyId &&
      portal !== null &&
      portal.publicationState !== 'archived'
      ? portal
      : null
  }

  return {
    getTimezone: (organizationId, propertyId) =>
      propertyApi.getPropertyTimezone(
        toOrganizationId(organizationId),
        toPropertyId(propertyId),
      ),
    listCurrentPortalIds: (organizationId, propertyId, limit) =>
      portalApi.listCurrentPortalIds(
        toOrganizationId(organizationId),
        toPropertyId(propertyId),
        limit,
      ),
    subjectBelongsToProperty: async (organizationId, propertyId, subject) => {
      if (subject.kind === 'property') return subject.propertyId === propertyId
      if (subject.kind === 'portal_group') {
        return portalGroupApi.portalGroupBelongsToProperty(
          toOrganizationId(organizationId),
          toPropertyId(propertyId),
          toPortalGroupId(subject.portalGroupId),
        )
      }
      return (await currentPortal(organizationId, propertyId, subject.portalId)) !== null
    },
    getSubjectName: async (organizationId, propertyId, subject) => {
      if (subject.kind === 'portal') {
        const portal = await currentPortal(organizationId, propertyId, subject.portalId)
        return portal?.name ?? null
      }
      const group = await portalGroupApi.getGroupInfo(
        toOrganizationId(organizationId),
        toPortalGroupId(subject.portalGroupId),
      )
      return group?.propertyId === propertyId ? group.name : null
    },
  }
}
