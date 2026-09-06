import { describe, expect, it, vi } from 'vitest'
import type { RestoreReviewLifecycleRuntimeTarget } from '#/shared/ops/restore-verify'
import type { ReviewLifecycleRecoveryExecutionStore } from './ports/lifecycle-recovery-execution-store.port'
import type {
  ReviewSourceContentLifecycleResult,
  RunReviewSourceContentLifecycle,
} from './use-cases/run-source-content-lifecycle'
import { createReviewLifecycleRecoveryAuthorityFactory } from './recovery-maintenance'

const NOW = new Date('2026-08-28T10:00:00.000Z')
const TARGET: RestoreReviewLifecycleRuntimeTarget = {
  releaseSha: 'a'.repeat(40),
  releaseManifestSha256: 'b'.repeat(64),
  restorePointAt: new Date('2026-08-28T09:00:00.000Z'),
  restoreDatabaseServiceName: 'Postgres-restored-20260828-0900',
  railwayProjectId: 'project-us',
  railwayEnvironmentId: 'environment-us',
  operatorId: 'operator@example.com',
  correlationId: 'recovery-maintenance-test',
}

function lifecyclePage(mode: 'report' | 'shadow'): ReviewSourceContentLifecycleResult {
  return {
    contract: 'review-source-content-lifecycle-v1',
    mode,
    scope: { kind: 'expired' },
    evaluatedAt: NOW.toISOString(),
    status: 'complete',
    scanned: 2,
    lifecycle: { eligible: 0, expired: 2, tombstone: 0, unverifiable: 0 },
    shadow:
      mode === 'shadow'
        ? { matched: 2, drifted: 0, findingCounts: {}, driftedReviewIds: [] }
        : null,
    nextCheckpoint: null,
    apply: {
      enabled: false,
      reason: 'external_shadow_parity_and_cutover_approval_required',
    },
  }
}

function executionStore(): ReviewLifecycleRecoveryExecutionStore {
  return {
    resume: vi.fn(async () => null),
    begin: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
  }
}

describe('Review lifecycle recovery maintenance factory', () => {
  it('keeps missing or partial approval credentials inspection-only', async () => {
    const run = vi.fn<RunReviewSourceContentLifecycle>(async (input) => {
      if (input.mode === 'apply') throw new Error('inspection may not apply')
      return lifecyclePage(input.mode)
    })
    const factory = createReviewLifecycleRecoveryAuthorityFactory({
      clock: () => NOW,
      createRunLifecycle: () => run,
      executions: executionStore(),
      createRecoveryRunId: () => '10000000-0000-4000-8000-000000000099',
      loadNextRecoveryGeneration: vi.fn(async () => 4),
    })

    const authority = factory.createAuthority({
      approvalContent: '{"incomplete":true}',
    })

    expect(authority.kind).toBe('inspection_only')
    if (authority.kind !== 'inspection_only') throw new Error('unreachable')
    const plan = await authority.prepare(TARGET)
    expect(plan.expired).toBe(2)
    expect(plan.requestSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls.some(([input]) => input.mode === 'apply')).toBe(false)
  })

  it('refuses an invalid complete keyring instead of weakening to inspection authority', () => {
    const factory = createReviewLifecycleRecoveryAuthorityFactory({
      clock: () => NOW,
      createRunLifecycle: () => vi.fn() as RunReviewSourceContentLifecycle,
      executions: executionStore(),
      createRecoveryRunId: () => '10000000-0000-4000-8000-000000000099',
      loadNextRecoveryGeneration: vi.fn(async () => 4),
    })

    expect(() =>
      factory.createAuthority({
        approvalContent: '{}\n',
        approvalBundleSha256: '0'.repeat(64),
        approvalPublicKeysJson: '{}',
      }),
    ).toThrow('approval public keyring is invalid')
  })
})
