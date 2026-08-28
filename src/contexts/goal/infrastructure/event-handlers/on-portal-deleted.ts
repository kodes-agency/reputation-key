// Goal context — PortalDeleted event handler
// Cancels active goals scoped to the deleted portal.
// Per architecture: event handler subscribes via EventBus, drives use case.

import type { PortalDeleted } from '#/contexts/portal/application/public-api'
import type { GoalRepository } from '../../application/ports/goal.repository'
import type { SystemCancelGoalFn } from './index'
import type { LoggerPort } from '#/shared/domain/logger.port'

// ── Dependencies ──────────────────────────────────────────────────────

export type OnPortalDeletedDeps = Readonly<{
  goalRepo: GoalRepository
  systemCancelGoalFn: SystemCancelGoalFn
  logger: Pick<LoggerPort, 'error'>
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
        const result = await deps.systemCancelGoalFn({
          goalId: goal.id,
          organizationId: event.organizationId,
          reason: 'portal_deleted',
        })
        if (result.isErr()) {
          deps.logger.error(
            { errorCode: result.error.tag },
            'goal: failed to cancel on portal deleted',
          )
        }
      }
    } catch (err) {
      deps.logger.error({ err }, 'goal: fatal error in onPortalDeleted')
    }
  }
