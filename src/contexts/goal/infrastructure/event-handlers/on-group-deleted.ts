// Goal context — PortalGroupDeleted event handler
// Cancels active goals scoped to the deleted portal group.
import type { PortalGroupDeleted } from '#/contexts/portal/application/public-api'
import type { GoalRepository } from '../../application/ports/goal.repository'
import type { Goal } from '../../domain/types'
import type { GoalId, OrganizationId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import type { Result } from '#/shared/domain'
import type { getLogger as getLoggerType } from '#/shared/observability/logger'

export type OnGroupDeletedDeps = Readonly<{
  goalRepo: GoalRepository
  cancelGoalFn: (
    input: Readonly<{ goalId: GoalId; organizationId: OrganizationId; role: Role }>,
  ) => Promise<Result<Goal, unknown>>
  getLogger: typeof getLoggerType
}>

export const onGroupDeleted =
  (deps: OnGroupDeletedDeps) =>
  async (event: PortalGroupDeleted): Promise<void> => {
    try {
      const goals = await deps.goalRepo.list({
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        groupId: event.groupId,
        status: 'active',
      })

      for (const goal of goals) {
        const result = await deps.cancelGoalFn({
          goalId: goal.id,
          organizationId: event.organizationId,
          role: 'AccountAdmin',
        })
        if (result.isErr()) {
          deps
            .getLogger()
            .error(
              { err: result.error, goalId: goal.id },
              'goal: failed to cancel on group deleted',
            )
        }
      }
    } catch (err) {
      deps
        .getLogger()
        .error({ err, groupId: event.groupId }, 'goal: fatal error in onGroupDeleted')
    }
  }
