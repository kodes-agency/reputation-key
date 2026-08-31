import { describe, expect, it, vi } from 'vitest'
import { createPurgeExpiredReviewsHandler } from './purge-expired-reviews.job'
import { openRetentionRun } from '#/shared/db/retention/evidence'
import { REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT } from '../../application/use-cases/run-source-content-lifecycle'

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

vi.mock('#/shared/db/retention/evidence', () => ({
  openRetentionRun: vi.fn(),
  closeRetentionRun: vi.fn(),
  failRetentionRun: vi.fn(),
}))

describe('createPurgeExpiredReviewsHandler', () => {
  it('routes the legacy purge seam through the checkpointed report authority without deleting Review data', async () => {
    const nextCheckpoint = {
      contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
      mode: 'report' as const,
      scope: { kind: 'expired' as const },
      evaluatedAt: '2026-08-26T00:00:00.000Z',
      after: {
        createdAt: '2026-08-25T00:00:00.000Z',
        reviewId: '00000000-0000-4000-8000-000000000002',
      },
    }
    const runLifecycle = vi.fn(async () => ({
      contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
      mode: 'report' as const,
      scope: { kind: 'expired' as const },
      evaluatedAt: '2026-08-26T00:00:00.000Z',
      status: 'checkpointed' as const,
      scanned: 2,
      lifecycle: { eligible: 1, expired: 1, tombstone: 0, unverifiable: 0 },
      shadow: null,
      nextCheckpoint,
      apply: {
        enabled: false as const,
        reason: 'external_shadow_parity_and_cutover_approval_required' as const,
      },
    }))
    const enqueueContinuation = vi.fn(async () => undefined)

    const result = await createPurgeExpiredReviewsHandler({
      runLifecycle,
      enqueueContinuation,
      logger: { warn: vi.fn() },
    })({} as never)

    expect(runLifecycle).toHaveBeenCalledWith({ mode: 'report', batchSize: 100 })
    expect(enqueueContinuation).toHaveBeenCalledWith({
      mode: 'report',
      batchSize: 100,
      checkpoint: nextCheckpoint,
    })
    expect(result).toMatchObject({
      status: 'report_only',
      batches: 1,
      purged: 0,
      failed: 0,
      batchRows: [2],
      report: {
        contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
        mode: 'report',
        scanned: 2,
        apply: { enabled: false },
      },
    })
    expect(openRetentionRun).not.toHaveBeenCalled()
  })
})
