// Goal context — TeamDeleted event handler
// Cancels active goals scoped to the deleted team.
// Per architecture: event handler subscribes via EventBus, drives use case.

import type { TeamDeleted } from '#/contexts/team/domain/events'
import type { GoalRepository } from '../../application/ports/goal.repository'
import type { Goal } from '../../domain/types'
import type { GoalId, OrganizationId } from '#/shared/domain/ids'
import type { Result } from 'neverthrow'
import type { getLogger as getLoggerType } from '#/shared/observability/logger'

// ── Dependencies ──────────────────────────────────────────────────────

export type OnTeamDeletedDeps = Readonly<{
  goalRepo: GoalRepository
  cancelGoalFn: (
    input: Readonly<{ goalId: GoalId; organizationId: OrganizationId }>,
  ) => Promise<Result<Goal, unknown>>
  getLogger: typeof getLoggerType
}>

// ── Handler factory ───────────────────────────────────────────────────

export const onTeamDeleted =
  (deps: OnTeamDeletedDeps) =>
  async (event: TeamDeleted): Promise<void> => {
    const goals = await deps.goalRepo.list({
      organizationId: event.organizationId,
      teamId: event.teamId,
      status: 'active',
    })

    for (const goal of goals) {
      const result = await deps.cancelGoalFn({
        goalId: goal.id,
        organizationId: event.organizationId,
      })
      if (result.isErr()) {
        deps
          .getLogger()
          .error(
            { err: result.error, goalId: goal.id },
            'goal: failed to cancel on team deleted',
          )
      }
    }
  }
