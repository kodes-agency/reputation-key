import { describe, expect, it, vi } from 'vitest'
import { createReclaimPendingIdentityUploadsHandler } from './reclaim-pending-identity-uploads.job'

describe('Pending image upload reclaim job', () => {
  it('runs one pass, takes nothing from the job payload, and logs counts only', async () => {
    const reclaim = vi.fn(async () => ({
      reclaimed: 2,
      failed: 1,
      listingTruncated: false,
    }))
    const logger = { info: vi.fn() }

    await createReclaimPendingIdentityUploadsHandler({ reclaim, logger })({
      data: { key: 'avatars/someone/must-not-be-used' },
    } as never)

    expect(reclaim).toHaveBeenCalledExactlyOnceWith()
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(
      {
        job: 'identity-pending-upload-reclaim',
        reclaimed: 2,
        failed: 1,
        listingTruncated: false,
      },
      'Pending image upload reclaim completed',
    )
  })

  it('lets a failed pass fail the job, so the queue retries it', async () => {
    const reclaim = vi.fn(async () => {
      throw new Error('store unavailable')
    })

    await expect(
      createReclaimPendingIdentityUploadsHandler({ reclaim, logger: { info: vi.fn() } })(
        {} as never,
      ),
    ).rejects.toThrow('store unavailable')
  })
})
