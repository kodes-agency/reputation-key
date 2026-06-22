// Goal context — PortalGroupDeleted event handler
// Cancels active goals scoped to the deleted portal group.
// Per architecture: event handler subscribes via EventBus, drives use case.

import type { PortalGroupDeleted } from '#/contexts/portal/application/public-api'
import type { GoalRepository } from '../../application/ports/goal.repository'
import type { Goal } from '../../domain/types'
import type { GoalId, OrganizationId, UserId } from '#/shared/domain/ids'
import { userId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import type { Result } from 'neverthrow'
import type { getLogger as getLoggerType } from '#/shared/observability/logger'

// ── Dependencies ──────────────────────────────────────────────────────

export type OnPortalGroupDeletedDeps = Readonly<{
  goalRepo: GoalRepository
  cancelGoalFn: (
    input: Readonly<{
      goalId: GoalId
      organizationId: OrganizationId
      userId: UserId
      role: Role
    }>,
  ) => Promise<Result<Goal, unknown>>
  getLogger: typeof getLoggerType
}>

// ── Handler factory ───────────────────────────────────────────────────

export const onPortalGroupDeleted =
  (deps: OnPortalGroupDeletedDeps) =>
  async (event: PortalGroupDeleted): Promise<void> => {
    try {
      const goals = await deps.goalRepo.list({
        organizationId: event.organizationId,
        portalGroupId: event.portalGroupId,
        status: 'active',
      })

      for (const goal of goals) {
        const result = await deps.cancelGoalFn({
          goalId: goal.id,
          organizationId: event.organizationId,
          userId: userId('system'),
          role: 'AccountAdmin',
        })
        if (result.isErr()) {
          deps
            .getLogger()
            .error(
              { err: result.error, goalId: goal.id },
              'goal: failed to cancel on portal group deleted',
            )
        }
      }
    } catch (err) {
      deps
        .getLogger()
        .error(
          { err, portalGroupId: event.portalGroupId },
          'goal: fatal error in onPortalGroupDeleted',
        )
    }
  }
