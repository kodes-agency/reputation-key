import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import {
  GoalProgramMaintenanceError,
  type GoalProgramMaintenanceStats,
  type GoalProgramService,
} from '../../application/use-cases/goal-programs'
import {
  createGoalProgramMaintenanceHandler,
  GOAL_PROGRAM_MAINTENANCE_JOB_NAME,
} from './goal-program-maintenance.job'

const stats = (
  overrides: Partial<GoalProgramMaintenanceStats> = {},
): GoalProgramMaintenanceStats => ({
  inspected: 3,
  activated: 1,
  scheduledResults: 2,
  reconciled: 1,
  closed: 0,
  denied: 0,
  unavailable: 0,
  stranded: 0,
  failed: 0,
  ...overrides,
})

const harness = (maintain: GoalProgramService['maintain']) => {
  const logger = { warn: vi.fn() }
  const service = { maintain } as unknown as GoalProgramService
  return {
    logger,
    run: () => createGoalProgramMaintenanceHandler(service, logger)({} as Job),
  }
}

describe('goal-program maintenance job', () => {
  it('has a stable governed job name and delegates exactly once', async () => {
    const outcome = stats()
    const maintain = vi.fn().mockResolvedValue(outcome)
    const { logger, run } = harness(maintain)

    const result = await run()

    expect(GOAL_PROGRAM_MAINTENANCE_JOB_NAME).toBe('goal-program.maintain')
    expect(maintain).toHaveBeenCalledOnce()
    expect(result).toEqual(outcome)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  // A stranded result can never reconcile or close, and retrying cannot help,
  // so maintenance counts it instead of failing. The count alone sat in the
  // BullMQ return value, where nobody looks. Tenant identifiers are never log
  // fields (BQC-7.3), so the warning carries counts only.
  it('warns, with counts only, when a run leaves results stranded', async () => {
    const { logger, run } = harness(vi.fn().mockResolvedValue(stats({ stranded: 2 })))

    await expect(run()).resolves.toMatchObject({ stranded: 2 })

    expect(logger.warn).toHaveBeenCalledOnce()
    expect(logger.warn).toHaveBeenCalledWith(
      { jobName: GOAL_PROGRAM_MAINTENANCE_JOB_NAME, stranded: 2, inspected: 3 },
      expect.stringContaining('outside their version window'),
    )
  })

  it('still warns about stranded results when the same run fails', async () => {
    const failure = new GoalProgramMaintenanceError(stats({ stranded: 1, failed: 1 }))
    const { logger, run } = harness(vi.fn().mockRejectedValue(failure))

    await expect(run()).rejects.toBe(failure)

    expect(logger.warn).toHaveBeenCalledWith(
      { jobName: GOAL_PROGRAM_MAINTENANCE_JOB_NAME, stranded: 1, inspected: 3 },
      expect.stringContaining('outside their version window'),
    )
  })
})
