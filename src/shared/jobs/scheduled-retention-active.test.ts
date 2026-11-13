import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { SCHEDULED_RETENTION_ACTIVE } from '#/shared/db/retention/scheduled-retention-activation'
import { createScheduledRetentionSweepHandler } from './retention-sweep.job'

const apply = vi.hoisted(() =>
  vi.fn(async () => ({ batches: 0, rowsDeleted: 0, rowsRedacted: 0, capped: false })),
)
vi.mock('#/shared/db/retention/execute-retention-rule', () => ({
  executeRetentionRule: apply,
}))
vi.mock('#/shared/db/retention/evidence', () => ({
  openRetentionRun: vi.fn(async () => 'run-1'),
  closeRetentionRun: vi.fn(async () => {}),
}))

describe('scheduled retention as shipped', () => {
  it('is on', () => {
    expect(SCHEDULED_RETENTION_ACTIVE).toBe(true)
  })

  it('runs every sweep and the registry rules on the daily schedule', async () => {
    const swept = { batches: 1, processed: 0, capped: false, completedThrough: null }
    const guestSweep = vi.fn(async () => swept)
    const reviewSweep = vi.fn(async () => swept)
    const snapshotRunSweep = vi.fn(async () => ({
      batches: 1,
      runs: 0,
      members: 0,
      capped: false,
    }))
    const importSweep = vi.fn(async () => ({
      expiredItemsVisited: 0,
      receiptsReconciled: 0,
      itemsTerminalized: 0,
      parentsPurged: 0,
      propertyReceiptsSwept: 0,
      unreleasedExpiredReceipts: 0,
    }))
    const rule = {
      subject: 'example.expired',
      table: 'example',
      keyColumns: ['id'],
      tsColumn: 'expires_at',
      olderThanMs: 0,
    }
    const handler = createScheduledRetentionSweepHandler({
      db: { execute: vi.fn() } as unknown as Database,
      clock: () => new Date('2026-11-14T03:00:00Z'),
      rules: [rule],
      guestContactRequestRetentionSweep: guestSweep,
      reviewObservationRetentionSweep: reviewSweep,
      reviewSnapshotRunRetentionSweep: snapshotRunSweep,
      googleImportLifecycleSweep: importSweep,
    })

    await expect(handler({ data: {} } as never)).resolves.not.toEqual({
      mode: 'inactive',
    })

    expect(guestSweep).toHaveBeenCalledWith({ batchSize: 500 })
    expect(reviewSweep).toHaveBeenCalledWith({ batchSize: 500 })
    expect(snapshotRunSweep).toHaveBeenCalledOnce()
    expect(importSweep).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledOnce()
  })
})
