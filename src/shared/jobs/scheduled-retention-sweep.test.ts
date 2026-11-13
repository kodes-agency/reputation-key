import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { createScheduledRetentionSweepHandler } from './retention-sweep.job'

const apply = vi.hoisted(() => vi.fn())
vi.mock('#/shared/db/retention/execute-retention-rule', () => ({
  executeRetentionRule: apply,
}))
vi.mock('#/shared/db/retention/evidence', () => ({
  openRetentionRun: vi.fn(async () => 'run-1'),
  closeRetentionRun: vi.fn(async () => {}),
}))
// Retention ships on (scheduled-retention-active.test.ts); these hold the branch a
// release that switched it off again would run.
vi.mock('#/shared/db/retention/scheduled-retention-activation', () => ({
  SCHEDULED_RETENTION_ACTIVE: false,
}))

describe('scheduled retention activation', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([{}, { mode: 'apply' }, { active: true }])(
    'erases only expired Contact Request material while inactive, whatever the queue data asks: %j',
    async (data) => {
      const execute = vi.fn()
      const guestSweep = vi.fn(async () => ({
        batches: 1,
        processed: 2,
        capped: false,
        completedThrough: null,
      }))
      const reviewSweep = vi.fn()
      const snapshotRunSweep = vi.fn()
      const importSweep = vi.fn()
      const handler = createScheduledRetentionSweepHandler({
        db: { execute } as unknown as Database,
        clock: () => new Date('2026-11-08T00:00:00Z'),
        guestContactRequestRetentionSweep: guestSweep,
        reviewObservationRetentionSweep: reviewSweep,
        reviewSnapshotRunRetentionSweep: snapshotRunSweep,
        googleImportLifecycleSweep: importSweep,
      })

      await expect(handler({ data } as never)).resolves.toEqual({ mode: 'inactive' })

      expect(execute).not.toHaveBeenCalled()
      expect(apply).not.toHaveBeenCalled()
      expect(guestSweep).toHaveBeenCalledWith({ batchSize: 500 })
      expect(reviewSweep).not.toHaveBeenCalled()
      expect(snapshotRunSweep).not.toHaveBeenCalled()
      expect(importSweep).not.toHaveBeenCalled()
    },
  )
})

describe('scheduled retention activation failures', () => {
  it('fails the job when the Contact Request purge fails while inactive', async () => {
    const handler = createScheduledRetentionSweepHandler({
      db: { execute: vi.fn() } as unknown as Database,
      clock: () => new Date('2026-11-08T00:00:00Z'),
      guestContactRequestRetentionSweep: vi.fn(async () => {
        throw new Error('purge unavailable')
      }),
    })

    await expect(handler({ data: {} } as never)).rejects.toThrow(
      'guest_contact_requests.expired_material',
    )
  })
})
