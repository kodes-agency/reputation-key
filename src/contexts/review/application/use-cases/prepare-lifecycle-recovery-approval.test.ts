import { describe, expect, it, vi } from 'vitest'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { ReviewLifecycleRecoveryRuntimeTarget } from '#/shared/ops/review-lifecycle-recovery-approval'
import { prepareReviewLifecycleRecoveryApproval } from './prepare-lifecycle-recovery-approval'
import type {
  ReviewSourceContentLifecycleResult,
  RunReviewSourceContentLifecycle,
} from './run-source-content-lifecycle'

const EVALUATED_AT = new Date('2026-08-28T10:00:00.000Z')
const RUN_ID = '10000000-0000-4000-8000-000000000991'

const target: ReviewLifecycleRecoveryRuntimeTarget = {
  releaseSha: 'a'.repeat(40),
  releaseManifestSha256: 'b'.repeat(64),
  restorePointAt: new Date('2026-08-28T09:00:00.000Z'),
  restoreDatabaseServiceName: 'Postgres-restored-20260828-0900',
  railwayProjectId: 'project-us',
  railwayEnvironmentId: 'environment-restored',
  operatorId: 'operator@example.com',
  correlationId: 'correlation-approval-plan',
}

function page(mode: 'report' | 'shadow'): ReviewSourceContentLifecycleResult {
  return {
    contract: 'review-source-content-lifecycle-v1',
    mode,
    scope: { kind: 'expired' },
    evaluatedAt: EVALUATED_AT.toISOString(),
    status: 'complete',
    scanned: 3,
    lifecycle: { eligible: 0, expired: 3, tombstone: 0, unverifiable: 0 },
    shadow:
      mode === 'shadow'
        ? {
            matched: 3,
            drifted: 0,
            findingCounts: {},
            driftedReviewIds: [],
          }
        : null,
    nextCheckpoint: null,
    apply: {
      enabled: false,
      reason: 'external_shadow_parity_and_cutover_approval_required',
    },
  }
}

describe('Review lifecycle recovery approval preparation', () => {
  it('emits one canonical content-free report and exact immutable request without apply', async () => {
    const runLifecycle = vi.fn<RunReviewSourceContentLifecycle>(async (input) => {
      if (input.mode === 'apply') throw new Error('apply must stay unavailable')
      return page(input.mode)
    })
    const plan = await prepareReviewLifecycleRecoveryApproval(target, {
      clock: () => EVALUATED_AT,
      createRunLifecycle: () => runLifecycle,
      createRecoveryRunId: () => RUN_ID,
      loadNextRecoveryGeneration: vi.fn(async () => 12),
    })

    expect(runLifecycle).toHaveBeenCalledTimes(2)
    expect(runLifecycle).toHaveBeenNthCalledWith(1, {
      mode: 'report',
      batchSize: 100,
    })
    expect(runLifecycle).toHaveBeenNthCalledWith(2, {
      mode: 'shadow',
      batchSize: 100,
    })
    expect(plan.request.target).toMatchObject({
      releaseSha: target.releaseSha,
      releaseManifestSha256: target.releaseManifestSha256,
      restoreDatabaseServiceName: target.restoreDatabaseServiceName,
      recoveryRunId: RUN_ID,
      recoveryGeneration: 12,
    })
    expect(plan.request.lifecycle).toMatchObject({
      evaluatedAt: EVALUATED_AT.toISOString(),
      reportSha256: plan.reportSha256,
      batchSize: 100,
    })
    expect(plan.requestContent.endsWith('\n')).toBe(true)
    expect(plan.requestContent).toBe(`${canonicalizeRfc8785(plan.request)}\n`)
    expect(plan.reportContent).toBe(`${canonicalizeRfc8785(plan.report)}\n`)
    expect(plan.requestSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(plan.reportSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(JSON.stringify(plan)).not.toMatch(
      /reviewId|organizationId|propertyId|reviewText|providerPayload/u,
    )
  })

  it('refuses an invalid recovery tuple or a plan window before the restore point', async () => {
    const runLifecycle = vi.fn<RunReviewSourceContentLifecycle>(async (input) =>
      page(input.mode === 'apply' ? 'report' : input.mode),
    )
    await expect(
      prepareReviewLifecycleRecoveryApproval(target, {
        clock: () => new Date('2026-08-28T08:59:59.999Z'),
        createRunLifecycle: () => runLifecycle,
        createRecoveryRunId: () => RUN_ID,
        loadNextRecoveryGeneration: async () => 12,
      }),
    ).rejects.toThrow(/cannot precede the restore point/)
    await expect(
      prepareReviewLifecycleRecoveryApproval(target, {
        clock: () => EVALUATED_AT,
        createRunLifecycle: () => runLifecycle,
        createRecoveryRunId: () => 'not-a-uuid',
        loadNextRecoveryGeneration: async () => 12,
      }),
    ).rejects.toThrow(/request is invalid/)
  })
})
