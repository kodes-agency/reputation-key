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
import type { GoalProgramSubjectReader } from '../../application/use-cases/goal-programs'

/** Cross-context, tenant-bound subject validation for canonical Goal Programs. */
export function createGoalProgramSubjectReader(
  propertyApi: PropertyFactsPublicApi,
  portalApi: PortalPublicApi,
  portalGroupApi: PortalGroupPublicApi,
): GoalProgramSubjectReader {
  return {
    getTimezone: (organizationId, propertyId) =>
      propertyApi.getPropertyTimezone(
        toOrganizationId(organizationId),
        toPropertyId(propertyId),
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
      const context = await portalApi.resolvePortalContext(toPortalId(subject.portalId))
      return (
        context?.organizationId === organizationId && context.propertyId === propertyId
      )
    },
  }
}
