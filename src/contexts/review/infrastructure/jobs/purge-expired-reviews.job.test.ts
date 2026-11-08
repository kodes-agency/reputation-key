import { describe, expect, it, vi } from 'vitest'
import { createPurgeExpiredReviewsHandler } from './purge-expired-reviews.job'
import { openRetentionRun } from '#/shared/db/retention/evidence'
import {
  REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
  REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
  createRunReviewSourceContentLifecycle,
} from '../../application/use-cases/run-source-content-lifecycle'

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

vi.mock('#/shared/db/retention/evidence', () => ({
  openRetentionRun: vi.fn(),
  closeRetentionRun: vi.fn(),
  failRetentionRun: vi.fn(),
}))

describe('createPurgeExpiredReviewsHandler', () => {
  it('refuses explicit apply in ordinary wiring before touching storage', async () => {
    const store = { readInspectionBatch: vi.fn(), applyLifecycleBatch: vi.fn() }
    const handler = createPurgeExpiredReviewsHandler({
      runLifecycle: createRunReviewSourceContentLifecycle({
        store,
        clock: () => new Date('2026-11-08T00:00:00.000Z'),
      }),
      logger: { warn: vi.fn() },
    })

    await expect(
      handler({
        data: {
          mode: 'apply',
          applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
        },
      } as never),
    ).rejects.toMatchObject({ code: 'review_destructive_lifecycle_quarantined' })
    expect(store.applyLifecycleBatch).not.toHaveBeenCalled()
    expect(store.readInspectionBatch).not.toHaveBeenCalled()
  })

  it('runs scheduled apply only when trusted wiring supplies apply confirmation', async () => {
    const result = {
      contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
      mode: 'apply' as const,
      scope: { kind: 'expired' as const },
      evaluatedAt: '2026-11-08T00:00:00.000Z',
      status: 'complete' as const,
      scanned: 0,
      lifecycle: { eligible: 0, expired: 0, tombstone: 0, unverifiable: 0 },
      shadow: null,
      nextCheckpoint: null,
      apply: {
        enabled: true as const,
        approval: {
          approvalId: 'expiry-approval',
          evidenceSha256: 'a'.repeat(64),
          approvedAt: '2026-11-07T00:00:00.000Z',
        },
        rowsRedacted: 0,
        legacyGoogleRepliesReconciled: 0,
      },
    }
    const runLifecycle = vi.fn(async () => result)
    const handler = createPurgeExpiredReviewsHandler({
      runLifecycle,
      scheduledApplyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
      logger: { warn: vi.fn() },
    })
    await handler({ data: {} } as never)
    expect(runLifecycle).toHaveBeenCalledWith({
      mode: 'apply',
      scope: { kind: 'expired' },
      batchSize: 100,
      applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
    })
  })

  it('applies only expiry and carries the approval-bound checkpoint to the next job', async () => {
    const approval = {
      approvalId: 'expiry-approval',
      evidenceSha256: 'a'.repeat(64),
      approvedAt: '2026-11-07T00:00:00.000Z',
    }
    const checkpoint = {
      contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
      mode: 'apply' as const,
      scope: { kind: 'expired' as const },
      evaluatedAt: '2026-11-08T00:00:00.000Z',
      after: {
        createdAt: '2026-10-01T00:00:00.000Z',
        reviewId: '00000000-0000-4000-8000-000000000001',
      },
      approval,
    }
    const runLifecycle = vi.fn(async () => ({
      contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
      mode: 'apply' as const,
      scope: checkpoint.scope,
      evaluatedAt: checkpoint.evaluatedAt,
      status: 'checkpointed' as const,
      scanned: 1,
      lifecycle: { eligible: 0, expired: 1, tombstone: 0, unverifiable: 0 },
      shadow: null,
      nextCheckpoint: checkpoint,
      apply: {
        enabled: true as const,
        approval,
        rowsRedacted: 1,
        legacyGoogleRepliesReconciled: 0,
      },
    }))
    const enqueueContinuation = vi.fn()
    const handler = createPurgeExpiredReviewsHandler({
      runLifecycle,
      enqueueContinuation,
      logger: { warn: vi.fn() },
    })
    const result = await handler({
      data: {
        mode: 'apply',
        applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
      },
    } as never)

    expect(runLifecycle).toHaveBeenCalledWith({
      mode: 'apply',
      scope: { kind: 'expired' },
      batchSize: 100,
      applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
    })
    expect(enqueueContinuation).toHaveBeenCalledWith({
      mode: 'apply',
      batchSize: 100,
      checkpoint,
      applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
    })
    expect(result).toMatchObject({ status: 'budget_exhausted', purged: 1 })
    await expect(
      createPurgeExpiredReviewsHandler({
        runLifecycle,
        logger: { warn: vi.fn() },
      })({
        data: {
          mode: 'apply',
          applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
        },
      } as never),
    ).rejects.toThrow('continuation cannot make progress')
  })

  it.each([
    {
      data: { mode: 'invalid' },
      message: 'Invalid Review source-content lifecycle mode',
    },
    {
      data: { applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION },
      message: 'Review expiry apply requires explicit confirmation',
    },
    {
      data: { mode: 'apply' },
      message: 'Review expiry apply requires explicit confirmation',
    },
    {
      data: { mode: 'apply', applyConfirmation: 'wrong' },
      message: 'Review expiry apply requires explicit confirmation',
    },
    {
      data: {
        mode: 'report',
        applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
      },
      message: 'Review expiry apply requires explicit confirmation',
    },
    ...['connection', 'property', 'organization'].map((kind) => ({
      data: {
        mode: 'apply',
        applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
        checkpoint: { scope: { kind } },
      },
      message: 'Review expiry jobs cannot apply a connection or one-off scope',
    })),
  ])(
    'rejects invalid or one-off apply before invoking the authority: $data',
    async ({ data, message }) => {
      const runLifecycle = vi.fn()
      const handler = createPurgeExpiredReviewsHandler({
        runLifecycle,
        logger: { warn: vi.fn() },
      })
      await expect(handler({ data } as never)).rejects.toThrow(new TypeError(message))
      expect(runLifecycle).not.toHaveBeenCalled()
    },
  )

  it.each([undefined, null, {}])(
    'routes legacy job data %j through the checkpointed report authority without deleting Review data',
    async (data) => {
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
      })({ data } as never)

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
    },
  )
})
