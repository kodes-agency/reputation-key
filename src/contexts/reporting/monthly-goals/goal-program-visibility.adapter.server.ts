import type { StaffPublicApi } from '#/contexts/identity/public-api'
import type { PortalGroupPublicApi } from '#/contexts/portal/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  organizationId as toOrganizationId,
  propertyId as toPropertyId,
  userId as toUserId,
} from '#/shared/domain/ids'
import type { GoalProgramVisibilityPort } from './goal-program-visibility.server'

/** Resolves an actor's responsible Portals through People, then their Portal Groups. */
export const createGoalProgramVisibilityAdapter =
  (
    staffApi: Pick<StaffPublicApi, 'getAssignedPortals'>,
    portalGroupApi: Pick<PortalGroupPublicApi, 'findGroupIdsByPortalIds'>,
  ): GoalProgramVisibilityPort =>
  async ({ actor, propertyId }) => {
    const ctx: AuthContext = {
      ...actor,
      userId: toUserId(actor.userId),
      organizationId: toOrganizationId(actor.organizationId),
    }
    const portalIds = await staffApi.getAssignedPortals(
      { userId: ctx.userId, propertyId: toPropertyId(propertyId) },
      ctx,
    )
    const groupIds = await portalGroupApi.findGroupIdsByPortalIds(
      ctx.organizationId,
      portalIds,
    )
    return { portalIds, groupIds }
  }
