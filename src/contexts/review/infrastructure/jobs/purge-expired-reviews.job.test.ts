import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReplyCommandStore } from '../../application/ports/reply-command-store.port'
import { createPurgeExpiredReviewsHandler } from './purge-expired-reviews.job'
import { openRetentionRun } from '#/shared/db/retention/evidence'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

vi.mock('#/shared/db/retention/evidence', () => ({
  openRetentionRun: vi.fn(),
  closeRetentionRun: vi.fn(),
  failRetentionRun: vi.fn(),
}))

describe('createPurgeExpiredReviewsHandler', () => {
  it('drains legacy jobs as quarantined without reading or deleting Review data', async () => {
    const reviewRepo = {
      findExpiredBatchBeforeAcrossTenants: vi.fn(),
    } as unknown as ReviewRepository
    const commandStore = {
      purgeExpiredReview: vi.fn(),
    } as unknown as ReplyCommandStore
    const clock = vi.fn(() => new Date('2026-08-26T00:00:00.000Z'))

    const result = await createPurgeExpiredReviewsHandler({
      reviewRepo,
      commandStore,
      clock,
      db: {} as Database,
    })({} as never)

    expect(result).toEqual({
      status: 'quarantined',
      batches: 0,
      purged: 0,
      failed: 0,
      batchRows: [],
    })
    expect(reviewRepo.findExpiredBatchBeforeAcrossTenants).not.toHaveBeenCalled()
    expect(commandStore.purgeExpiredReview).not.toHaveBeenCalled()
    expect(clock).not.toHaveBeenCalled()
    expect(openRetentionRun).not.toHaveBeenCalled()
  })
})
