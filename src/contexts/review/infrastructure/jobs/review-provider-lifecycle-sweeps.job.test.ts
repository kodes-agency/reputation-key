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

  it('sweeps tombstones at equality without inventing a continuation', async () => {
    const deps = makeDeps()
    const handler = createSweepReviewProviderTombstonesHandler(deps as never)
    await handler({
      data: { beforeOrAtEpochMillis: cutoff, afterReviewId: null, limit: 100 },
    } as never)
    expect(deps.repository.sweepExpiredTombstones).toHaveBeenCalledWith({
      beforeOrAt: new Date(cutoff),
      afterReviewId: null,
      limit: 100,
    })
    expect(deps.enqueueTombstoneContinuation).not.toHaveBeenCalled()
  })

  it.each([0, 101])('rejects an out-of-bounds batch size %s', async (limit) => {
    const deps = makeDeps()
    const handler = createExpireReviewProviderSourceHandler(deps as never)
    await expect(
      handler({
        data: { beforeOrAtEpochMillis: cutoff, afterReviewId: null, limit },
      } as never),
    ).rejects.toThrow('Invalid Review provider lifecycle sweep bounds')
    expect(deps.repository.expireRawSourceBatch).not.toHaveBeenCalled()
  })
})
