import { describe, expect, it, vi } from 'vitest'
import { reviewId } from '#/shared/domain/ids'
import type {
  ReviewSourceContentLifecycleInspection,
  ReviewSourceContentLifecycleScope,
  ReviewSourceContentLifecycleStore,
} from '../ports/source-content-lifecycle-store.port'
import {
  REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
  REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
  createRunReviewSourceContentLifecycle,
} from './run-source-content-lifecycle'

const EVALUATED_AT = new Date('2026-08-26T12:00:00.000Z')
const EXPIRED_SCOPE = { kind: 'expired' } as const
const PROPERTY_SCOPE = {
  kind: 'property',
  organizationId: 'review-lifecycle-org' as never,
  propertyId: '00000000-0000-4000-8000-000000000099' as never,
} satisfies ReviewSourceContentLifecycleScope

function inspection(
  ordinal: number,
  patch: Partial<ReviewSourceContentLifecycleInspection> = {},
): ReviewSourceContentLifecycleInspection {
  return {
    reviewId: reviewId(`00000000-0000-4000-8000-${ordinal.toString().padStart(12, '0')}`),
    createdAt: new Date(`2026-08-${String(ordinal).padStart(2, '0')}T00:00:00.000Z`),
    sourceContentState: 'active',
    lifecycleClock: new Date('2026-09-01T00:00:00.000Z'),
    shadowFindings: [],
    ...patch,
  }
}

function storeWith(
  rows: ReadonlyArray<ReviewSourceContentLifecycleInspection>,
): ReviewSourceContentLifecycleStore {
  return {
    readInspectionBatch: vi.fn(async () => rows),
    applyLifecycleBatch: vi.fn(async () => ({
      rows,
      hasMore: false,
      rowsRedacted: 0,
      legacyGoogleRepliesReconciled: 0,
    })),
  }
}

describe('run Review source-content lifecycle', () => {
  it('reports one bounded page and returns a frozen keyset checkpoint without apply authority', async () => {
    const store = storeWith([
      inspection(1),
      inspection(2, { lifecycleClock: EVALUATED_AT }),
      inspection(3, { sourceContentState: 'source_expired', lifecycleClock: null }),
    ])
    const run = createRunReviewSourceContentLifecycle({
      store,
      clock: () => EVALUATED_AT,
    })

    const result = await run({ mode: 'report', batchSize: 2 })

    expect(store.readInspectionBatch).toHaveBeenCalledWith({
      evaluatedAt: EVALUATED_AT,
      after: null,
      limit: 3,
      scope: EXPIRED_SCOPE,
    })
    expect(result).toEqual({
      contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
      mode: 'report',
      scope: EXPIRED_SCOPE,
      evaluatedAt: EVALUATED_AT.toISOString(),
      status: 'checkpointed',
      scanned: 2,
      lifecycle: { eligible: 1, expired: 1, tombstone: 0, unverifiable: 0 },
      shadow: null,
      nextCheckpoint: {
        contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
        mode: 'report',
        scope: EXPIRED_SCOPE,
        evaluatedAt: EVALUATED_AT.toISOString(),
        after: {
          createdAt: '2026-08-02T00:00:00.000Z',
          reviewId: '00000000-0000-4000-8000-000000000002',
        },
      },
      apply: {
        enabled: false,
        reason: 'external_shadow_parity_and_cutover_approval_required',
      },
    })
  })

  it('resumes the same frozen report window without consulting a new wall clock', async () => {
    const store = storeWith([
      inspection(3, { sourceContentState: 'provider_deleted', lifecycleClock: null }),
    ])
    const clock = vi.fn(() => new Date('2026-09-30T00:00:00.000Z'))
    const run = createRunReviewSourceContentLifecycle({ store, clock })

    const result = await run({
      mode: 'report',
      batchSize: 2,
      checkpoint: {
        contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
        mode: 'report',
        scope: EXPIRED_SCOPE,
        evaluatedAt: EVALUATED_AT.toISOString(),
        after: {
          createdAt: '2026-08-02T00:00:00.000Z',
          reviewId: '00000000-0000-4000-8000-000000000002',
        },
      },
    })

    expect(clock).not.toHaveBeenCalled()
    expect(store.readInspectionBatch).toHaveBeenCalledWith({
      evaluatedAt: EVALUATED_AT,
      after: {
        createdAt: new Date('2026-08-02T00:00:00.000Z'),
        reviewId: reviewId('00000000-0000-4000-8000-000000000002'),
      },
      limit: 3,
      scope: EXPIRED_SCOPE,
    })
    expect(result.status).toBe('complete')
    expect(result.lifecycle).toEqual({
      eligible: 0,
      expired: 0,
      tombstone: 1,
      unverifiable: 0,
    })
    expect(result.nextCheckpoint).toBeNull()
  })

  it('shadows content-free parity findings without exposing provider content', async () => {
    const store = storeWith([
      inspection(1),
      inspection(2, {
        shadowFindings: ['active_compatibility_drift', 'active_observation_missing'],
      }),
      inspection(3, {
        sourceContentState: 'source_expired',
        lifecycleClock: null,
        shadowFindings: ['tombstone_google_reply_content_present'],
      }),
    ])
    const run = createRunReviewSourceContentLifecycle({
      store,
      clock: () => EVALUATED_AT,
    })

    const result = await run({ mode: 'shadow', batchSize: 3 })

    expect(result.shadow).toEqual({
      matched: 1,
      drifted: 2,
      findingCounts: {
        active_compatibility_drift: 1,
        active_observation_missing: 1,
        tombstone_google_reply_content_present: 1,
      },
      driftedReviewIds: [
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003',
      ],
    })
    expect(JSON.stringify(result)).not.toContain('provider-controlled')
    expect(result.apply.enabled).toBe(false)
  })

  it('rejects a checkpoint from another mode before reading storage', async () => {
    const store = storeWith([])
    const run = createRunReviewSourceContentLifecycle({
      store,
      clock: () => EVALUATED_AT,
    })

    await expect(
      run({
        mode: 'shadow',
        batchSize: 20,
        checkpoint: {
          contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
          mode: 'report',
          scope: EXPIRED_SCOPE,
          evaluatedAt: EVALUATED_AT.toISOString(),
          after: {
            createdAt: '2026-08-02T00:00:00.000Z',
            reviewId: '00000000-0000-4000-8000-000000000002',
          },
        },
      }),
    ).rejects.toThrow('checkpoint mode does not match the requested lifecycle mode')
    expect(store.readInspectionBatch).not.toHaveBeenCalled()
  })

  it('rejects a legacy/unbound checkpoint before reading storage', async () => {
    const store = storeWith([])
    const run = createRunReviewSourceContentLifecycle({
      store,
      clock: () => EVALUATED_AT,
    })

    await expect(
      run({
        mode: 'report',
        batchSize: 20,
        checkpoint: {
          contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
          mode: 'report',
          evaluatedAt: EVALUATED_AT.toISOString(),
          after: {
            createdAt: '2026-08-02T00:00:00.000Z',
            reviewId: '00000000-0000-4000-8000-000000000002',
          },
        } as never,
      }),
    ).rejects.toThrow('checkpoint scope is required')
    expect(store.readInspectionBatch).not.toHaveBeenCalled()
  })

  it('rejects an apply confirmation attached to a read-only inspection', async () => {
    const store = storeWith([])
    const run = createRunReviewSourceContentLifecycle({
      store,
      clock: () => EVALUATED_AT,
    })

    await expect(
      run({
        mode: 'report',
        batchSize: 20,
        applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
      }),
    ).rejects.toThrow('inspection cannot carry apply confirmation')
    expect(store.readInspectionBatch).not.toHaveBeenCalled()
  })

  it('fails closed when apply is requested without an injected reviewed authority', async () => {
    const store = storeWith([inspection(1)])
    const run = createRunReviewSourceContentLifecycle({
      store,
      clock: () => EVALUATED_AT,
    })

    await expect(
      run({
        mode: 'apply',
        batchSize: 20,
        applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
      }),
    ).rejects.toMatchObject({
      code: 'review_destructive_lifecycle_quarantined',
    })
    expect(store.applyLifecycleBatch).not.toHaveBeenCalled()
  })

  it('fails closed before authorization when apply lacks the exact typed confirmation', async () => {
    const store = storeWith([inspection(1)])
    const authorizeApply = vi.fn()
    const run = createRunReviewSourceContentLifecycle({
      store,
      clock: () => EVALUATED_AT,
      authorizeApply,
    })

    await expect(run({ mode: 'apply', batchSize: 20 })).rejects.toMatchObject({
      code: 'review_destructive_lifecycle_quarantined',
    })
    expect(authorizeApply).not.toHaveBeenCalled()
    expect(store.applyLifecycleBatch).not.toHaveBeenCalled()
  })

  it('forwards restore receipt identity only on an authorized apply page', async () => {
    const store = storeWith([])
    const recoveryExecution = {
      recoveryRunId: '10000000-0000-4000-8000-000000000001',
      recoveryGeneration: 7,
      approvalId: 'REV-01-restore-2026-08-28',
      approvalBundleSha256: 'a'.repeat(64),
    }
    const run = createRunReviewSourceContentLifecycle({
      store,
      clock: () => EVALUATED_AT,
      authorizeApply: vi.fn(async () => ({
        approvalId: recoveryExecution.approvalId,
        evidenceSha256: 'b'.repeat(64),
        approvedAt: '2026-08-26T12:05:00.000Z',
      })),
    })

    await expect(
      run({ mode: 'report', batchSize: 20, recoveryExecution }),
    ).rejects.toThrow('inspection cannot carry recovery execution')
    await run({
      mode: 'apply',
      batchSize: 20,
      applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
      recoveryExecution,
    })

    expect(store.applyLifecycleBatch).toHaveBeenCalledWith({
      evaluatedAt: EVALUATED_AT,
      after: null,
      limit: 20,
      scope: EXPIRED_SCOPE,
      recoveryExecution,
    })
  })

  it('applies one whole bounded batch and binds its continuation to revalidated approval evidence', async () => {
    const rows = [
      inspection(1, { lifecycleClock: EVALUATED_AT }),
      inspection(2, {
        shadowFindings: ['active_google_sync_reply_redundant'],
      }),
    ]
    const store = storeWith(rows)
    vi.mocked(store.applyLifecycleBatch).mockResolvedValue({
      rows,
      hasMore: true,
      rowsRedacted: 1,
      legacyGoogleRepliesReconciled: 1,
    })
    const approval = {
      approvalId: 'REV-01-cutover-2026-08-26',
      evidenceSha256: 'a'.repeat(64),
      approvedAt: '2026-08-26T10:00:00.000Z',
    } as const
    const authorizeApply = vi.fn(async () => ({
      ...approval,
      untrustedExtraField: 'must-not-cross-the-content-free-boundary',
    }))
    const run = createRunReviewSourceContentLifecycle({
      store,
      clock: () => EVALUATED_AT,
      authorizeApply,
    })

    const result = await run({
      mode: 'apply',
      batchSize: 2,
      applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
    })

    expect(authorizeApply).toHaveBeenCalledWith({
      contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
      evaluatedAt: EVALUATED_AT,
      scope: EXPIRED_SCOPE,
      priorApproval: null,
    })
    expect(store.applyLifecycleBatch).toHaveBeenCalledWith({
      evaluatedAt: EVALUATED_AT,
      after: null,
      limit: 2,
      scope: EXPIRED_SCOPE,
    })
    expect(result).toMatchObject({
      mode: 'apply',
      scope: EXPIRED_SCOPE,
      status: 'checkpointed',
      lifecycle: { eligible: 1, expired: 1, tombstone: 0, unverifiable: 0 },
      shadow: {
        matched: 1,
        drifted: 1,
        findingCounts: { active_google_sync_reply_redundant: 1 },
      },
      apply: {
        enabled: true,
        approval,
        rowsRedacted: 1,
        legacyGoogleRepliesReconciled: 1,
      },
      nextCheckpoint: { approval },
    })
    expect(JSON.stringify(result)).not.toContain('untrustedExtraField')
    expect(JSON.stringify(result)).not.toContain('must-not-cross')
  })

  it('denies an apply continuation when current authority does not reproduce its frozen approval', async () => {
    const store = storeWith([])
    const priorApproval = {
      approvalId: 'REV-01-cutover-2026-08-26',
      evidenceSha256: 'a'.repeat(64),
      approvedAt: '2026-08-26T10:00:00.000Z',
    } as const
    const run = createRunReviewSourceContentLifecycle({
      store,
      clock: () => EVALUATED_AT,
      authorizeApply: vi.fn(async () => ({
        ...priorApproval,
        evidenceSha256: 'b'.repeat(64),
      })),
    })

    await expect(
      run({
        mode: 'apply',
        batchSize: 20,
        checkpoint: {
          contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
          mode: 'apply',
          scope: EXPIRED_SCOPE,
          evaluatedAt: EVALUATED_AT.toISOString(),
          after: {
            createdAt: '2026-08-02T00:00:00.000Z',
            reviewId: '00000000-0000-4000-8000-000000000002',
          },
          approval: priorApproval,
        },
        applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
      }),
    ).rejects.toThrow('approval evidence changed')
    expect(store.applyLifecycleBatch).not.toHaveBeenCalled()
  })

  it('binds a scoped checkpoint and rejects a continuation whose scope changes', async () => {
    const store = storeWith([inspection(1), inspection(2)])
    const run = createRunReviewSourceContentLifecycle({
      store,
      clock: () => EVALUATED_AT,
    })

    const first = await run({
      mode: 'shadow',
      scope: PROPERTY_SCOPE,
      batchSize: 1,
    })

    expect(store.readInspectionBatch).toHaveBeenCalledWith({
      evaluatedAt: EVALUATED_AT,
      after: null,
      limit: 2,
      scope: PROPERTY_SCOPE,
    })
    expect(first.nextCheckpoint).toMatchObject({ scope: PROPERTY_SCOPE })

    await expect(
      run({
        mode: 'shadow',
        scope: EXPIRED_SCOPE,
        batchSize: 1,
        checkpoint: first.nextCheckpoint!,
      }),
    ).rejects.toThrow('checkpoint scope does not match')
  })
})
