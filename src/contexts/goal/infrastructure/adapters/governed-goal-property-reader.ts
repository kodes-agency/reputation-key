import type { PropertyFactsPublicApi } from '#/contexts/property/application/public-api'
import type { PortalGroupPublicApi } from '#/contexts/portal/application/public-api'
import {
  organizationId as toOrganizationId,
  portalGroupId as toPortalGroupId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import type { GoalPropertyReader } from '../../application/use-cases/governed-goals'

/** Tenant-bound property facts required by the governed Goal lifecycle. */
export const createGovernedGoalPropertyReader = (
  propertyApi: PropertyFactsPublicApi,
  portalGroupApi: PortalGroupPublicApi,
): GoalPropertyReader => {
  return {
    getTimezone: (organizationId, propertyId) =>
      propertyApi.getPropertyTimezone(
        toOrganizationId(organizationId),
        toPropertyId(propertyId),
      ),
    portalGroupBelongsToProperty: (organizationId, propertyId, portalGroupId) =>
      portalGroupApi.portalGroupBelongsToProperty(
        toOrganizationId(organizationId),
        toPropertyId(propertyId),
        toPortalGroupId(portalGroupId),
      ),
  }
}
