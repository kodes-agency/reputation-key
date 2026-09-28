import { describe, expect, it, vi } from 'vitest'
import {
  createExpireReviewProviderSourceHandler,
  createSweepReviewProviderTombstonesHandler,
} from './review-provider-lifecycle-sweeps.job'

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

const cutoff = Date.parse('2026-08-16T12:00:00.000Z')

function makeDeps() {
  return {
    repository: {
      expireRawSourceBatch: vi.fn(async () => ({
        transitioned: 100,
        nextReviewId: '00000000-0000-4000-8000-000000000010',
      })),
      sweepExpiredTombstones: vi.fn(async () => ({ deleted: 1, nextReviewId: null })),
    },
    enqueueExpiryContinuation: vi.fn(async () => undefined),
    enqueueTombstoneContinuation: vi.fn(async () => undefined),
  }
}

describe('Review provider lifecycle sweep jobs', () => {
  it('drains a valid legacy expiry job without deleting stable Review or Reply history', async () => {
    const deps = makeDeps()
    const handler = createExpireReviewProviderSourceHandler(deps as never)
    await expect(
      handler({
        data: { beforeOrAtEpochMillis: cutoff, afterReviewId: null, limit: 100 },
      } as never),
    ).resolves.toEqual({ status: 'quarantined', transitioned: 0, nextReviewId: null })
    expect(deps.repository.expireRawSourceBatch).not.toHaveBeenCalled()
    expect(deps.enqueueExpiryContinuation).not.toHaveBeenCalled()
  })

  it('drains a valid tombstone sweep job without deleting subjects or snapshot runs', async () => {
    const deps = makeDeps()
    const handler = createSweepReviewProviderTombstonesHandler(deps as never)
    await expect(
      handler({
        data: { beforeOrAtEpochMillis: cutoff, afterReviewId: null, limit: 100 },
      } as never),
    ).resolves.toEqual({ status: 'quarantined', deleted: 0, nextReviewId: null })
    expect(deps.repository.sweepExpiredTombstones).not.toHaveBeenCalled()
    expect(deps.enqueueTombstoneContinuation).not.toHaveBeenCalled()
  })

  it.each([0, 101])('rejects an out-of-bounds batch size %s', async (limit) => {
    const deps = makeDeps()
    const job = {
      data: { beforeOrAtEpochMillis: cutoff, afterReviewId: null, limit },
    } as never
    await expect(
      createExpireReviewProviderSourceHandler(deps as never)(job),
    ).rejects.toThrow('Invalid Review provider lifecycle sweep bounds')
    await expect(
      createSweepReviewProviderTombstonesHandler(deps as never)(job),
    ).rejects.toThrow('Invalid Review provider lifecycle sweep bounds')
    expect(deps.repository.expireRawSourceBatch).not.toHaveBeenCalled()
    expect(deps.repository.sweepExpiredTombstones).not.toHaveBeenCalled()
  })
})
