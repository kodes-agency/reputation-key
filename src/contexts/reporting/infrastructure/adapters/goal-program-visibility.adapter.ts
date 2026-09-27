import type { PortalGroupPublicApi } from '#/contexts/portal/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  organizationId as toOrganizationId,
  propertyId as toPropertyId,
  userId as toUserId,
} from '#/shared/domain/ids'
import type { StaffPortalResolverPort } from '../../application/ports/staff-portal-resolver.port'
import type { GoalProgramVisibilityPort } from '../../application/use-cases/goal-program-visibility'

/** Resolves an actor's responsible Portals through People, then their Portal Groups. */
export const createGoalProgramVisibilityAdapter =
  (
    resolveAssignedPortals: StaffPortalResolverPort,
    portalGroupApi: Pick<PortalGroupPublicApi, 'findGroupIdsByPortalIds'>,
  ): GoalProgramVisibilityPort =>
  async ({ actor, propertyId }) => {
    const ctx: AuthContext = {
      ...actor,
      userId: toUserId(actor.userId),
      organizationId: toOrganizationId(actor.organizationId),
    }
    const portalIds = await resolveAssignedPortals(
      { userId: ctx.userId, propertyId: toPropertyId(propertyId) },
      ctx,
    )
    const groupIds = await portalGroupApi.findGroupIdsByPortalIds(
      ctx.organizationId,
      portalIds,
    )
    return { portalIds, groupIds }
  }
