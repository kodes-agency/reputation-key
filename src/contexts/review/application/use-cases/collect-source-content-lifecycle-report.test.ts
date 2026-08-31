import { describe, expect, it, vi } from 'vitest'
import type {
  ReviewSourceContentLifecycleCheckpoint,
  ReviewSourceContentLifecycleResult,
  RunReviewSourceContentLifecycle,
} from './run-source-content-lifecycle'
import { collectReviewSourceContentLifecycleReport } from './collect-source-content-lifecycle-report'

const CHECKPOINT: ReviewSourceContentLifecycleCheckpoint = {
  contract: 'review-source-content-lifecycle-v1',
  mode: 'report',
  scope: { kind: 'expired' },
  evaluatedAt: '2026-08-28T00:00:00.000Z',
  after: {
    createdAt: '2026-08-27T00:00:00.000Z',
    reviewId: '10000000-0000-4000-8000-000000000001',
  },
}

const page = (
  overrides: Partial<ReviewSourceContentLifecycleResult>,
): ReviewSourceContentLifecycleResult => ({
  contract: 'review-source-content-lifecycle-v1',
  mode: 'report',
  scope: { kind: 'expired' },
  evaluatedAt: '2026-08-28T00:00:00.000Z',
  status: 'complete',
  scanned: 0,
  lifecycle: { eligible: 0, expired: 0, tombstone: 0, unverifiable: 0 },
  shadow: null,
  nextCheckpoint: null,
  apply: {
    enabled: false,
    reason: 'external_shadow_parity_and_cutover_approval_required',
  },
  ...overrides,
})

describe('collectReviewSourceContentLifecycleReport', () => {
  it('drains one frozen checkpoint chain and totals content-free counts', async () => {
    const run = vi
      .fn<RunReviewSourceContentLifecycle>()
      .mockResolvedValueOnce(
        page({
          status: 'checkpointed',
          scanned: 100,
          lifecycle: { eligible: 75, expired: 20, tombstone: 3, unverifiable: 2 },
          nextCheckpoint: CHECKPOINT,
        }),
      )
      .mockResolvedValueOnce(
        page({
          scanned: 4,
          lifecycle: { eligible: 1, expired: 2, tombstone: 1, unverifiable: 0 },
        }),
      )

    await expect(
      collectReviewSourceContentLifecycleReport(run, {
        mode: 'report',
        batchSize: 100,
      }),
    ).resolves.toEqual({
      mode: 'report',
      scope: { kind: 'expired' },
      evaluatedAt: '2026-08-28T00:00:00.000Z',
      pages: 2,
      scanned: 104,
      lifecycle: { eligible: 76, expired: 22, tombstone: 4, unverifiable: 2 },
      shadow: null,
    })
    expect(run).toHaveBeenNthCalledWith(1, { mode: 'report', batchSize: 100 })
    expect(run).toHaveBeenNthCalledWith(2, {
      mode: 'report',
      batchSize: 100,
      checkpoint: CHECKPOINT,
    })
  })

  it('totals shadow findings without exposing provider content', async () => {
    const run = vi.fn<RunReviewSourceContentLifecycle>().mockResolvedValue(
      page({
        mode: 'shadow',
        scanned: 3,
        shadow: {
          matched: 1,
          drifted: 2,
          findingCounts: {
            active_observation_missing: 1,
            tombstone_source_cache_present: 1,
          },
          driftedReviewIds: [
            '10000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000002',
          ],
        },
      }),
    )

    const result = await collectReviewSourceContentLifecycleReport(run, {
      mode: 'shadow',
      batchSize: 50,
    })

    expect(result.shadow).toEqual({
      matched: 1,
      drifted: 2,
      findingCounts: {
        active_observation_missing: 1,
        tombstone_source_cache_present: 1,
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/reviewer|text|rating/iu)
  })

  it('fails closed when a continuation does not advance', async () => {
    const run = vi.fn<RunReviewSourceContentLifecycle>().mockResolvedValue(
      page({
        status: 'checkpointed',
        scanned: 1,
        nextCheckpoint: CHECKPOINT,
      }),
    )

    await expect(
      collectReviewSourceContentLifecycleReport(run, {
        mode: 'report',
        batchSize: 100,
      }),
    ).rejects.toThrow(/did not advance/)
  })
})
