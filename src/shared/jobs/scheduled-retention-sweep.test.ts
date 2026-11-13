import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { createScheduledRetentionSweepHandler } from './retention-sweep.job'

const apply = vi.hoisted(() => vi.fn())
vi.mock('#/shared/db/retention/execute-retention-rule', () => ({
  executeRetentionRule: apply,
}))

describe('scheduled retention activation', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([{}, { mode: 'apply' }, { active: true }])(
    'ships inactive even when queue data asks to apply: %j',
    async (data) => {
      const execute = vi.fn()
      const guestSweep = vi.fn()
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
      expect(guestSweep).not.toHaveBeenCalled()
      expect(reviewSweep).not.toHaveBeenCalled()
      expect(snapshotRunSweep).not.toHaveBeenCalled()
      expect(importSweep).not.toHaveBeenCalled()
    },
  )
})
