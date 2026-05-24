// Goal context — PortalDeleted event handler
// Cancels active goals scoped to the deleted portal.
// Per architecture: event handler subscribes via EventBus, drives use case.

import type { PortalDeleted } from '#/contexts/portal/application/public-api'
import type { GoalRepository } from '../../application/ports/goal.repository'
import type { Goal } from '../../domain/types'
import type { GoalId, OrganizationId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import type { Result } from 'neverthrow'
import type { getLogger as getLoggerType } from '#/shared/observability/logger'

// ── Dependencies ──────────────────────────────────────────────────────

export type OnPortalDeletedDeps = Readonly<{
  goalRepo: GoalRepository
  cancelGoalFn: (
    input: Readonly<{ goalId: GoalId; organizationId: OrganizationId; role: Role }>,
  ) => Promise<Result<Goal, unknown>>
  getLogger: typeof getLoggerType
}>

// ── Handler factory ───────────────────────────────────────────────────

export const onPortalDeleted =
  (deps: OnPortalDeletedDeps) =>
  async (event: PortalDeleted): Promise<void> => {
    try {
      const goals = await deps.goalRepo.list({
        organizationId: event.organizationId,
        portalId: event.portalId,
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
              'goal: failed to cancel on portal deleted',
            )
        }
      }
    } catch (err) {
      deps
        .getLogger()
        .error({ err, portalId: event.portalId }, 'goal: fatal error in onPortalDeleted')
    }
  }
