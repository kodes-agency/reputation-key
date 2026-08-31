// Canonical Goal Program lifecycle maintenance.
//
// The recurring job is deliberately content-free and tenant-cross: the
// application service discovers bounded, identifier-only program rows and
// re-authorizes every property before activating a program, scheduling the
// next full property-local month, or reconciling a due result.

import type { Job } from 'bullmq'
import type { GoalProgramService } from '../../application/use-cases/goal-programs'

export const GOAL_PROGRAM_MAINTENANCE_JOB_NAME = 'goal-program.maintain' as const

export const createGoalProgramMaintenanceHandler = (service: GoalProgramService) => {
  return async (_job: Job) => service.maintain()
}
