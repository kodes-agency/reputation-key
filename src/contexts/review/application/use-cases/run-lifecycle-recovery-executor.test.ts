import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import {
  REVIEW_LIFECYCLE_RECOVERY_APPROVAL_VERSION,
  reviewLifecycleRecoveryApprovalSignaturePayload,
  type ReviewLifecycleRecoveryApprovalRequest,
} from '#/shared/ops/review-lifecycle-recovery-approval'
import type { RecoveryFenceResult } from '#/shared/ops/recovery-fence'
import type {
  ReviewLifecycleRecoveryExecutionProgress,
  ReviewLifecycleRecoveryExecutionStore,
} from '../ports/lifecycle-recovery-execution-store.port'
import {
  createRunReviewLifecycleRecoveryExecutor,
  type ReviewLifecycleRecoveryRuntimeTarget,
} from './run-lifecycle-recovery-executor'
import type {
  ReviewSourceContentLifecycleResult,
  RunReviewSourceContentLifecycle,
} from './run-source-content-lifecycle'

const EVALUATED_AT = '2026-08-28T10:00:00.000Z'

const target = (): ReviewLifecycleRecoveryRuntimeTarget => ({
  releaseSha: 'a'.repeat(40),
  releaseManifestSha256: 'b'.repeat(64),
  restorePointAt: new Date('2026-08-28T09:00:00.000Z'),
  restoreDatabaseServiceName: 'Postgres-restored-20260828-0900',
  railwayProjectId: 'project-us',
  railwayEnvironmentId: 'environment-restored',
  operatorId: 'operator@example.com',
  correlationId: 'correlation-1',
})

function lifecyclePage(
  mode: 'report' | 'shadow' | 'apply',
  patch: Partial<ReviewSourceContentLifecycleResult> = {},
): ReviewSourceContentLifecycleResult {
  return {
    contract: 'review-source-content-lifecycle-v1',
    mode,
    scope: { kind: 'expired' },
    evaluatedAt: EVALUATED_AT,
    status: 'complete',
    scanned: 2,
    lifecycle: { eligible: 0, expired: 2, tombstone: 0, unverifiable: 0 },
    shadow:
      mode === 'report'
        ? null
        : { matched: 2, drifted: 0, findingCounts: {}, driftedReviewIds: [] },
    nextCheckpoint: null,
    apply:
      mode === 'apply'
        ? {
            enabled: true,
            approval: {
              approvalId: 'REV-01-restore-2026-08-28',
              evidenceSha256: 'd'.repeat(64),
              approvedAt: '2026-08-28T10:05:00.000Z',
            },
            rowsRedacted: 2,
            legacyGoogleRepliesReconciled: 0,
          }
        : {
            enabled: false,
            reason: 'external_shadow_parity_and_cutover_approval_required',
          },
    ...patch,
  }
}

function progress(
  state: 'applying' | 'lifecycle_applied',
  patch: Partial<ReviewLifecycleRecoveryExecutionProgress> = {},
): ReviewLifecycleRecoveryExecutionProgress {
  return {
    state,
    reportExpired: 2,
    checkpoint: null,
    pages: 0,
    scanned: 0,
    rowsRedacted: 0,
    legacyGoogleRepliesReconciled: 0,
    ...patch,
  }
}

function memoryExecutionStore(
  resumed: ReviewLifecycleRecoveryExecutionProgress | null = null,
): ReviewLifecycleRecoveryExecutionStore & {
  resume: ReturnType<typeof vi.fn>
  begin: ReturnType<typeof vi.fn>
  complete: ReturnType<typeof vi.fn>
  fail: ReturnType<typeof vi.fn>
} {
  return {
    resume: vi.fn(async () => resumed),
    begin: vi.fn(async (input) => ({
      ...progress('applying', { reportExpired: input.reportExpired }),
      resumed: false,
    })),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  }
}

async function fixture(
  options: { resumed?: ReviewLifecycleRecoveryExecutionProgress } = {},
) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const runLifecycle = vi
    .fn<RunReviewSourceContentLifecycle>()
    .mockImplementation(async (input) =>
      lifecyclePage(input.mode, {
        ...(input.mode === 'apply'
          ? {
              apply: {
                enabled: true,
                approval: {
                  approvalId: 'REV-01-restore-2026-08-28',
                  evidenceSha256: 'placeholder',
                  approvedAt: '2026-08-28T10:05:00.000Z',
                },
                rowsRedacted: 2,
                legacyGoogleRepliesReconciled: 0,
              },
            }
          : {}),
      }),
    )

  // First use the public evidence collector through an unsigned executor
  // fixture to obtain the independently recomputed report digest.
  const { collectReviewLifecycleRecoveryEvidence } =
    await import('./collect-lifecycle-recovery-evidence')
  const evidence = await collectReviewLifecycleRecoveryEvidence(runLifecycle)
  runLifecycle.mockClear()

  const request: ReviewLifecycleRecoveryApprovalRequest = {
    version: REVIEW_LIFECYCLE_RECOVERY_APPROVAL_VERSION,
    kind: 'review-lifecycle-recovery',
    target: {
      releaseSha: target().releaseSha,
      releaseManifestSha256: target().releaseManifestSha256,
      restorePointAt: target().restorePointAt.toISOString(),
      restoreDatabaseServiceName: target().restoreDatabaseServiceName,
      railwayProjectId: target().railwayProjectId,
      railwayEnvironmentId: target().railwayEnvironmentId,
      recoveryRunId: '10000000-0000-4000-8000-000000000001',
      recoveryGeneration: 7,
    },
    lifecycle: {
      contract: evidence.report.contract,
      scope: evidence.report.scope,
      evaluatedAt: evidence.report.evaluatedAt,
      batchSize: evidence.report.batchSize,
      sourcePolicyVersion: evidence.report.sourcePolicyVersion,
      retentionPolicyVersion: evidence.report.retentionPolicyVersion,
      policySha256: evidence.report.policySha256,
      reportSha256: evidence.sha256,
    },
  }
  const requestSha256 = createHash('sha256')
    .update(canonicalizeRfc8785(request), 'utf8')
    .digest('hex')
  const unsigned = {
    approvalId: 'REV-01-restore-2026-08-28',
    decision: 'approved' as const,
    approverIdentity: 'privacy-operations@example.com',
    keyId: 'review-lifecycle-approver-1',
    approvedAt: '2026-08-28T10:05:00.000Z',
    expiresAt: '2026-08-28T18:05:00.000Z',
    requestSha256,
  }
  const bundle = {
    request,
    requestSha256,
    approval: {
      ...unsigned,
      signature: sign(
        null,
        reviewLifecycleRecoveryApprovalSignaturePayload(unsigned),
        privateKey,
      ).toString('base64'),
    },
  }
  const approvalContent = `${canonicalizeRfc8785(bundle)}\n`
  const approvalBundleSha256 = createHash('sha256')
    .update(approvalContent, 'utf8')
    .digest('hex')
  const executions = memoryExecutionStore(options.resumed ?? null)

  const executor = createRunReviewLifecycleRecoveryExecutor({
    approvalContent,
    approvalBundleSha256,
    trustedPublicKeys: new Map([[unsigned.keyId, publicKey]]),
    clock: () => new Date('2026-08-28T11:00:00.000Z'),
    createRunLifecycle: ({ authorizeApply }) => {
      expect(authorizeApply).toBeTypeOf('function')
      return runLifecycle
    },
    executions,
  })
  return { executor, executions, runLifecycle, evidence, bundle }
}

describe('sealed Review lifecycle recovery executor', () => {
  it('rechecks the signed report before reserving and applies only bounded Review pages', async () => {
    const { executor, executions, runLifecycle, bundle } = await fixture()

    const admitted = await executor.admit(target())
    await admitted.applyReviewLifecycle()

    expect(executions.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryRunId: bundle.request.target.recoveryRunId,
        recoveryGeneration: 7,
        approvalId: bundle.approval.approvalId,
        state: 'applying',
        reportExpired: 2,
      }),
    )
    expect(runLifecycle).toHaveBeenCalledWith({ mode: 'report', batchSize: 100 })
    expect(runLifecycle).toHaveBeenCalledWith({ mode: 'shadow', batchSize: 100 })
    expect(runLifecycle).toHaveBeenCalledWith({
      mode: 'apply',
      batchSize: 100,
      applyConfirmation: 'apply-review-source-content-lifecycle-v1',
      recoveryExecution: {
        recoveryRunId: bundle.request.target.recoveryRunId,
        recoveryGeneration: 7,
        approvalId: bundle.approval.approvalId,
        approvalBundleSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    })
  })

  it('resumes after Review lifecycle completion without applying a page twice', async () => {
    const { executor, executions, runLifecycle } = await fixture({
      resumed: progress('lifecycle_applied'),
    })

    const admitted = await executor.admit(target())
    await admitted.applyReviewLifecycle()

    expect(runLifecycle).not.toHaveBeenCalled()
    expect(executions.begin).not.toHaveBeenCalled()
  })

  it('resumes the exact durable checkpoint without re-reporting mutated rows', async () => {
    const checkpoint = {
      createdAt: new Date('2026-08-20T09:00:00.000Z'),
      reviewId: '10000000-0000-4000-8000-000000000099',
    }
    const { executor, executions, runLifecycle, bundle } = await fixture({
      resumed: progress('applying', {
        checkpoint,
        pages: 1,
        scanned: 100,
        rowsRedacted: 80,
      }),
    })

    const admitted = await executor.admit(target())
    await admitted.applyReviewLifecycle()

    expect(executions.begin).not.toHaveBeenCalled()
    expect(runLifecycle).toHaveBeenCalledTimes(1)
    expect(runLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'apply',
        checkpoint: expect.objectContaining({
          evaluatedAt: EVALUATED_AT,
          after: {
            createdAt: checkpoint.createdAt.toISOString(),
            reviewId: checkpoint.reviewId,
          },
        }),
        recoveryExecution: expect.objectContaining({
          recoveryRunId: bundle.request.target.recoveryRunId,
          recoveryGeneration: 7,
        }),
      }),
    )
  })

  it('binds completion to the exact recovery result and rejects another run', async () => {
    const { executor, executions } = await fixture()
    const admitted = await executor.admit(target())
    const result: RecoveryFenceResult = {
      id: '10000000-0000-4000-8000-000000000001',
      generation: 7,
      replayed: false,
      counts: {} as never,
      completedAt: new Date('2026-08-28T11:10:00.000Z'),
    }

    await admitted.complete(result)
    expect(executions.complete).toHaveBeenCalledWith(
      expect.objectContaining({ recoveryRunId: result.id, recoveryGeneration: 7 }),
    )
    await expect(admitted.complete({ ...result, generation: 8 })).rejects.toThrow(
      /does not match the approved recovery tuple/,
    )
  })

  it('refuses changed report evidence before creating a durable execution receipt', async () => {
    const { executor, executions, runLifecycle } = await fixture()
    runLifecycle.mockImplementation(async (input) =>
      lifecyclePage(input.mode, {
        lifecycle: { eligible: 0, expired: 3, tombstone: 0, unverifiable: 0 },
      }),
    )

    await expect(executor.admit(target())).rejects.toThrow(/wrong_target/)
    expect(executions.begin).not.toHaveBeenCalled()
  })

  it('records only a stable content-free code when a bounded apply page fails', async () => {
    const { executor, executions, runLifecycle } = await fixture()
    const privateMarker = 'private-review-text-must-not-enter-evidence'
    runLifecycle.mockImplementation(async (input) => {
      if (input.mode === 'apply') throw new Error(privateMarker)
      return lifecyclePage(input.mode)
    })

    const admitted = await executor.admit(target())
    await expect(admitted.applyReviewLifecycle()).rejects.toThrow(privateMarker)
    expect(executions.fail).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'review_lifecycle_apply_failed' }),
    )
    expect(JSON.stringify(executions.fail.mock.calls)).not.toContain(privateMarker)
  })
})
