import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import {
  createQuarantinedRollupHandler,
  JOB_NAMES,
} from './refresh-materialized-view.job'

describe('Metric rollup job quarantine', () => {
  it.each(Object.values(JOB_NAMES))(
    '%s logs its quarantine and performs no mutation',
    async (jobName) => {
      const logger = { warn: vi.fn() }

      await expect(
        createQuarantinedRollupHandler(jobName, logger)({} as Job),
      ).resolves.toBeUndefined()

      expect(logger.warn).toHaveBeenCalledTimes(1)
      expect(logger.warn).toHaveBeenCalledWith(
        { job: jobName },
        'quarantined rollup job invoked; no mutation (CNV-01 contraction pending)',
      )
    },
  )
})
