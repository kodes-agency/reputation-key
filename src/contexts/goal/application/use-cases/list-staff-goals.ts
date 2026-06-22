// Goal context — list staff goals use case
// Extracted from the server fn (D8-002): the entire flow — resolve assigned
// portals → resolve portal groups → list goals → filter by staff visibility →
// batch-fetch progress — now lives in a use case, testable independently.

import type { GoalRepository } from '../ports/goal.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { GoalWithProgress } from './list-goals'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalId, PortalGroupId, PropertyId } from '#/shared/domain/ids'

/** Port for resolving which portal groups a set of portals belongs to. */
export type PortalGroupLookupPort = Readonly<{
  findGroupIdsByPortalIds: (
    orgId: AuthContext['organizationId'],
    portalIds: ReadonlyArray<PortalId>,
  ) => Promise<ReadonlyArray<PortalGroupId>>
}>

export type ListStaffGoalsDeps = Readonly<{
  goalRepo: GoalRepository
  staffPublicApi: StaffPublicApi
  portalGroupLookup: PortalGroupLookupPort
}>

export type ListStaffGoalsInput = Readonly<{
  propertyId?: PropertyId
}>

export type ListStaffGoalsResult = ReadonlyArray<GoalWithProgress>

/** Concrete use case instance type — named, not derived via ReturnType. */
export type ListStaffGoals = (
  input: ListStaffGoalsInput,
  ctx: AuthContext,
) => Promise<ListStaffGoalsResult>

/**
 * List goals visible to the authenticated staff member.
 *
 * Steps:
 * 1. Resolve assigned portals for this staff member in the property
 * 2. Resolve portal groups from those portal IDs
 * 3. Query all goals for the org+property
 * 4. Filter to goals scoped to the staff member's portals/groups
 *    (property-scoped goals are excluded — staff should not see them)
 * 5. Batch-fetch progress for all visible goals
 */
export const listStaffGoals =
  (deps: ListStaffGoalsDeps): ListStaffGoals =>
  async (input, ctx) => {
    // No property selected — nothing to show
    if (!input.propertyId) return []

    // 1. Resolve assigned portals via staff public API
    const portalIds = await deps.staffPublicApi.getAssignedPortals(
      { userId: ctx.userId, propertyId: input.propertyId },
      ctx,
    )

    // 2. Resolve portal groups from portal IDs
    const groupIds =
      portalIds.length > 0
        ? await deps.portalGroupLookup.findGroupIdsByPortalIds(
            ctx.organizationId,
            portalIds,
          )
        : []

    // 3. Query goals for the org+property
    const allGoals = await deps.goalRepo.list({
      organizationId: ctx.organizationId,
      propertyId: input.propertyId,
    })

    // 4. Filter to staff-visible portals/groups
    const portalIdSet = new Set<PortalId>(portalIds)
    const groupIdSet = new Set<PortalGroupId>(groupIds)
    const goals = allGoals.filter((g) => {
      // Property-scoped goals are excluded — staff should not see them
      if (g.portalId === null && g.portalGroupId === null) return false
      if (g.portalId && portalIdSet.has(g.portalId)) return true
      if (g.portalGroupId && groupIdSet.has(g.portalGroupId)) return true
      return false
    })

    if (goals.length === 0) return []

    // 5. Batch-fetch progress for all goals
    const progressMap = await deps.goalRepo.getProgressBatch(
      goals.map((g) => g.id),
      ctx.organizationId,
    )

    return goals.map((goal) => ({
      goal,
      progress: progressMap.get(goal.id) ?? null,
    }))
  }
