import { describe, expect, it, vi } from 'vitest'
import {
  expireReviewProviderSourceHandler,
  sweepReviewProviderTombstonesHandler,
} from './review-provider-lifecycle-sweeps-job.server'

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

const cutoff = Date.parse('2026-08-16T12:00:00.000Z')

describe('Review provider lifecycle sweep jobs', () => {
  it('drains a valid legacy expiry job without deleting stable Review or Reply history', async () => {
    await expect(
      expireReviewProviderSourceHandler({
        data: { beforeOrAtEpochMillis: cutoff, afterReviewId: null, limit: 100 },
      } as never),
    ).resolves.toEqual({ status: 'quarantined', transitioned: 0, nextReviewId: null })
  })

  it('drains a valid tombstone sweep job without deleting subjects or snapshot runs', async () => {
    await expect(
      sweepReviewProviderTombstonesHandler({
        data: { beforeOrAtEpochMillis: cutoff, afterReviewId: null, limit: 100 },
      } as never),
    ).resolves.toEqual({ status: 'quarantined', deleted: 0, nextReviewId: null })
  })

  it.each([0, 101])('rejects an out-of-bounds batch size %s', async (limit) => {
    const job = {
      data: { beforeOrAtEpochMillis: cutoff, afterReviewId: null, limit },
    } as never
    await expect(expireReviewProviderSourceHandler(job)).rejects.toThrow(
      'Invalid Review provider lifecycle sweep bounds',
    )
    await expect(sweepReviewProviderTombstonesHandler(job)).rejects.toThrow(
      'Invalid Review provider lifecycle sweep bounds',
    )
  })
})
