// Canonical Goal Program lifecycle maintenance.
//
// The recurring job is deliberately content-free and tenant-cross: the
// application service discovers bounded, identifier-only program rows and
// re-authorizes every property before activating a program, scheduling the
// next full property-local month, or reconciling a due result.

import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  GoalProgramMaintenanceError,
  type GoalProgramMaintenanceStats,
  type GoalProgramService,
} from '../../application/use-cases/goal-programs'

export const GOAL_PROGRAM_MAINTENANCE_JOB_NAME = 'goal-program.maintain' as const

/**
 * A stranded result can never reconcile or close, so maintenance counts it
 * rather than failing every run. Say so each run it is seen, or the count only
 * reaches the BullMQ return value. Counts only: tenant identifiers are never
 * log fields (BQC-7.3).
 */
function warnAboutStranded(
  logger: Pick<LoggerPort, 'warn'>,
  stats: GoalProgramMaintenanceStats,
): void {
  if (stats.stranded === 0) return
  logger.warn(
    {
      jobName: GOAL_PROGRAM_MAINTENANCE_JOB_NAME,
      stranded: stats.stranded,
      inspected: stats.inspected,
    },
    'Goal maintenance: due results fall outside their version window and cannot reconcile or close',
  )
}

export const createGoalProgramMaintenanceHandler = (
  service: GoalProgramService,
  logger: Pick<LoggerPort, 'warn'>,
) => {
  return async (_job: Job) => {
    try {
      const stats = await service.maintain()
      warnAboutStranded(logger, stats)
      return stats
    } catch (error) {
      if (error instanceof GoalProgramMaintenanceError) {
        warnAboutStranded(logger, error.stats)
      }
      throw error
    }
  }
}
