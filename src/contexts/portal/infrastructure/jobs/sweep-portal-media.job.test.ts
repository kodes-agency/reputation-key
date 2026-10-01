import { describe, expect, it, vi } from 'vitest'
import { createSweepPortalMediaHandler } from './sweep-portal-media.job'

describe('Portal media sweep job', () => {
  it('runs one sweep, takes nothing from the job payload, and logs counts only', async () => {
    const sweep = vi.fn(async () => ({
      takenDownObjectsRemoved: 2,
      discarded: 3,
      failed: 1,
    }))
    const logger = { info: vi.fn() }

    await createSweepPortalMediaHandler({ sweep, logger })({
      data: { organizationId: 'must-not-be-used', assetId: 'must-not-be-used' },
    } as never)

    expect(sweep).toHaveBeenCalledExactlyOnceWith()
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(
      {
        job: 'portal-media-sweep',
        takenDownObjectsRemoved: 2,
        discarded: 3,
        failed: 1,
      },
      'Portal media sweep completed',
    )
  })

  it('lets a failed sweep fail the job, so the queue retries it', async () => {
    const sweep = vi.fn(async () => {
      throw new Error('database unavailable')
    })
    await expect(
      createSweepPortalMediaHandler({ sweep, logger: { info: vi.fn() } })({} as never),
    ).rejects.toThrow('database unavailable')
  })
})
