import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
  REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
  type ReviewSourceContentLifecycleResult,
} from '../application/use-cases/run-source-content-lifecycle'
import { createSourceContentPurge } from './source-content-purge'

const NOW = new Date('2026-08-28T00:00:00.000Z')
const ORG = organizationId('review-lifecycle-org')
const PROPERTY = propertyId('00000000-0000-4000-8000-000000000099')
const CONNECTION = '00000000-0000-4000-8000-000000000088'

function lifecycleResult(
  patch: Partial<ReviewSourceContentLifecycleResult> = {},
): ReviewSourceContentLifecycleResult {
  return {
    contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
    mode: 'report',
    scope: {
      kind: 'connection',
      organizationId: ORG,
      connectionId: CONNECTION,
    },
    evaluatedAt: NOW.toISOString(),
    status: 'complete',
    scanned: 2,
    lifecycle: { eligible: 1, expired: 1, tombstone: 0, unverifiable: 0 },
    shadow: null,
    nextCheckpoint: null,
    apply: {
      enabled: false,
      reason: 'external_shadow_parity_and_cutover_approval_required',
    },
    ...patch,
  }
}

describe('Review source-content purge compatibility adapter', () => {
  it('delegates connection cleanup to the checkpointed lifecycle as report-only by default', async () => {
    const runLifecycle = vi.fn(async () => lifecycleResult())
    const purge = createSourceContentPurge({
      db: {} as never,
      clock: () => NOW,
      runLifecycle,
      batchSize: 20,
    })

    const result = await purge.forConnection(ORG, CONNECTION)

    expect(runLifecycle).toHaveBeenCalledWith({
      mode: 'report',
      scope: { kind: 'connection', organizationId: ORG, connectionId: CONNECTION },
      batchSize: 20,
    })
    expect(result).toEqual({
      subject: 'reviews.purge.connection',
      batches: 1,
      rowsDeleted: 0,
      rowsRedacted: 0,
      nextCheckpoint: null,
    })
  })

  it('resumes only through the lifecycle checkpoint and returns bounded progress', async () => {
    const checkpoint = {
      contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
      mode: 'report' as const,
      scope: { kind: 'property' as const, organizationId: ORG, propertyId: PROPERTY },
      evaluatedAt: NOW.toISOString(),
      after: {
        createdAt: '2026-08-27T00:00:00.000Z',
        reviewId: '00000000-0000-4000-8000-000000000001',
      },
    }
    const runLifecycle = vi.fn(async () =>
      lifecycleResult({
        scope: checkpoint.scope,
        status: 'checkpointed',
        scanned: 20,
        nextCheckpoint: checkpoint,
      }),
    )
    const purge = createSourceContentPurge({
      db: {} as never,
      clock: () => NOW,
      runLifecycle,
      batchSize: 20,
      maxBatches: 1,
    })

    const result = await purge.forProperty(ORG, PROPERTY)

    expect(result).toMatchObject({
      subject: 'reviews.purge.property',
      batches: 1,
      rowsDeleted: 0,
      rowsRedacted: 0,
      nextCheckpoint: checkpoint,
    })
  })

  it('passes the exact confirmation on an explicitly admitted apply path', async () => {
    const runLifecycle = vi.fn(async () =>
      lifecycleResult({
        mode: 'apply',
        scope: { kind: 'organization', organizationId: ORG },
        apply: {
          enabled: true,
          approval: {
            approvalId: 'REV-01-approved',
            evidenceSha256: 'a'.repeat(64),
            approvedAt: '2026-08-27T00:00:00.000Z',
          },
          rowsRedacted: 3,
          legacyGoogleRepliesReconciled: 0,
        },
      }),
    )
    const purge = createSourceContentPurge({
      db: {} as never,
      clock: () => NOW,
      runLifecycle,
      applyAdmission: {
        confirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
        authorizeApply: vi.fn(),
      },
    })

    const result = await purge.forOrganization(ORG)

    expect(runLifecycle).toHaveBeenCalledWith({
      mode: 'apply',
      scope: { kind: 'organization', organizationId: ORG },
      batchSize: 100,
      applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
    })
    expect(result).toMatchObject({ rowsDeleted: 0, rowsRedacted: 3 })
  })

  it('rejects an unbounded adapter budget at construction', () => {
    expect(() =>
      createSourceContentPurge({
        db: {} as never,
        clock: () => NOW,
        runLifecycle: vi.fn(),
        maxBatches: 101,
      }),
    ).toThrow('maxBatches must be between 1 and 100')
  })

  it('fails closed when an authority returns a continuation without progress', async () => {
    const checkpoint = {
      contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
      mode: 'report' as const,
      scope: { kind: 'organization' as const, organizationId: ORG },
      evaluatedAt: NOW.toISOString(),
      after: {
        createdAt: '2026-08-27T00:00:00.000Z',
        reviewId: '00000000-0000-4000-8000-000000000001',
      },
    }
    const purge = createSourceContentPurge({
      db: {} as never,
      clock: () => NOW,
      runLifecycle: vi.fn(async () =>
        lifecycleResult({
          scope: checkpoint.scope,
          status: 'checkpointed',
          scanned: 0,
          nextCheckpoint: checkpoint,
        }),
      ),
    })

    await expect(purge.forOrganization(ORG)).rejects.toThrow(
      'continuation without progress',
    )
  })
})
