import { describe, expect, it, vi } from 'vitest'
import {
  REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
  type ReviewSourceContentLifecycleResult,
  type RunReviewSourceContentLifecycle,
} from './run-source-content-lifecycle'
import {
  REVIEW_LIFECYCLE_RECOVERY_REPORT_VERSION,
  collectReviewLifecycleRecoveryEvidence,
  reviewLifecyclePolicySha256,
} from './collect-lifecycle-recovery-evidence'

const EVALUATED_AT = '2026-08-28T10:00:00.000Z'

function page(
  mode: 'report' | 'shadow',
  patch: Partial<ReviewSourceContentLifecycleResult> = {},
): ReviewSourceContentLifecycleResult {
  return {
    contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
    mode,
    scope: { kind: 'expired' },
    evaluatedAt: EVALUATED_AT,
    status: 'complete',
    scanned: 3,
    lifecycle: { eligible: 1, expired: 2, tombstone: 0, unverifiable: 0 },
    shadow:
      mode === 'shadow'
        ? {
            matched: 2,
            drifted: 1,
            findingCounts: { active_google_sync_reply_redundant: 1 },
            driftedReviewIds: ['10000000-0000-4000-8000-000000000001'],
          }
        : null,
    nextCheckpoint: null,
    apply: {
      enabled: false,
      reason: 'external_shadow_parity_and_cutover_approval_required',
    },
    ...patch,
  }
}

describe('Review lifecycle recovery report evidence', () => {
  it('collects the frozen report and shadow windows into content-free canonical evidence', async () => {
    const run = vi
      .fn<RunReviewSourceContentLifecycle>()
      .mockImplementation(async (input) => page(input.mode as 'report' | 'shadow'))

    const evidence = await collectReviewLifecycleRecoveryEvidence(run)

    expect(run).toHaveBeenNthCalledWith(1, { mode: 'report', batchSize: 100 })
    expect(run).toHaveBeenNthCalledWith(2, { mode: 'shadow', batchSize: 100 })
    expect(evidence).toMatchObject({
      report: {
        version: REVIEW_LIFECYCLE_RECOVERY_REPORT_VERSION,
        contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
        scope: { kind: 'expired' },
        evaluatedAt: EVALUATED_AT,
        batchSize: 100,
        policySha256: reviewLifecyclePolicySha256(),
        lifecycle: { expired: 2, unverifiable: 0 },
        shadow: {
          matched: 2,
          drifted: 1,
          findingCounts: { active_google_sync_reply_redundant: 1 },
        },
      },
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    })
    expect(JSON.stringify(evidence)).not.toMatch(
      /10000000-0000-4000-8000-000000000001|reviewer|rating|text/iu,
    )
  })

  it('refuses report/shadow windows that are not exactly the same', async () => {
    const run = vi
      .fn<RunReviewSourceContentLifecycle>()
      .mockResolvedValueOnce(page('report'))
      .mockResolvedValueOnce(page('shadow', { evaluatedAt: '2026-08-28T10:00:01.000Z' }))

    await expect(collectReviewLifecycleRecoveryEvidence(run)).rejects.toThrow(
      /window changed/,
    )
  })
})
