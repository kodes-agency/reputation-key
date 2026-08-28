import { describe, expect, it, vi } from 'vitest'

const rollups = vi.hoisted(() => ({
  daily: vi.fn().mockResolvedValue({ partitionsRecomputed: 1 }),
  weekly: vi.fn().mockResolvedValue({ partitionsRecomputed: 0 }),
  inbox: vi.fn().mockResolvedValue({ partitionsRecomputed: 0 }),
}))

vi.mock('../incremental-rollup', () => ({
  refreshDailyMetricsIncrementally: rollups.daily,
  refreshWeeklyMetricsIncrementally: rollups.weekly,
  refreshDailyInboxMetricsIncrementally: rollups.inbox,
}))

import type { Job } from 'bullmq'
import type { Database } from '#/shared/db'
import { createRefreshRollupHandler } from './refresh-materialized-view.job'

describe('Metric rollup job runtime dependencies', () => {
  it('passes the composition-owned logger into the selected rollup', async () => {
    const db = {} as Database
    const logger = { debug: vi.fn(), info: vi.fn() }

    await createRefreshRollupHandler({ db, logger }, 'dailyMetrics')({} as Job)

    expect(rollups.daily).toHaveBeenCalledWith(db, logger)
    expect(logger.info).toHaveBeenCalledWith(
      {
        rollupType: 'dailyMetrics',
        result: { partitionsRecomputed: 1 },
      },
      'Incrementally refreshed rollup table',
    )
  })
})
