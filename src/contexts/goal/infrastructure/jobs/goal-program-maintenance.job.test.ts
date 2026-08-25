import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import type { GoalProgramService } from '../../application/use-cases/goal-programs'
import {
  createGoalProgramMaintenanceHandler,
  GOAL_PROGRAM_MAINTENANCE_JOB_NAME,
} from './goal-program-maintenance.job'

describe('goal-program maintenance job', () => {
  it('has a stable governed job name and delegates exactly once', async () => {
    const outcome = {
      inspected: 3,
      activated: 1,
      scheduledResults: 2,
      reconciled: 1,
      closed: 0,
      denied: 0,
      unavailable: 0,
      failed: 0,
    }
    const maintain = vi.fn().mockResolvedValue(outcome)
    const service = { maintain } as unknown as GoalProgramService

    const result = await createGoalProgramMaintenanceHandler(service)({} as Job)

    expect(GOAL_PROGRAM_MAINTENANCE_JOB_NAME).toBe('goal-program.maintain')
    expect(maintain).toHaveBeenCalledOnce()
    expect(result).toEqual(outcome)
  })
})
