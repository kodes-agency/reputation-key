// BQC-7.8 — ops:restore-verify command core (unit).
//
// The restore drill's verification step, run inside the isolated restored
// environment BEFORE cutover: hard-requires RESTORE_MODE=isolated + an
// attested loopback/Railway-PITR DATABASE_URL, runs every retention lifecycle
// and the recovery fence in process (never via BullMQ), proves no expired
// content or restored authority remains, prints evidence, and reminds the
// operator that cutover requires UNSETTING RESTORE_MODE.
//
// Deps are injected — these tests never touch a database; the real wiring
// proof lives in the integration test
// (src/shared/jobs/infrastructure/repositories/restore-verify.test.ts).

import { describe, it, expect, vi } from 'vitest'
import { createReviewLifecycleRecoveryAuthorityFactory } from '#/contexts/review/application/recovery-maintenance'
import { createRunReviewSourceContentLifecycle } from '#/contexts/review/application/use-cases/run-source-content-lifecycle'
import type { ReviewLifecycleRecoveryExecutionAuthorityInput } from '#/contexts/review/application/ports/lifecycle-recovery-execution-store.port'
import type { ReviewSourceContentLifecycleInspection } from '#/contexts/review/application/ports/source-content-lifecycle-store.port'
import { reviewId } from '#/shared/domain/ids'
import type { ReviewSourceContentLifecycleStore } from '#/contexts/review/application/ports/source-content-lifecycle-store.port'
import {
  validateOperatorArgs,
  type OperatorContext,
  type OperatorIO,
} from './operator-command'
import {
  RESTORE_PREFLIGHT_SPEC,
  RESTORE_VERIFY_REPLAY_NOTICE,
  RESTORE_VERIFY_SPEC,
  runRestoreVerifyAction,
  type RestoreVerifyDeps,
} from './restore-verify'

const ISOLATED_ENV = {
  RESTORE_MODE: 'isolated',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/restored',
  RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20260825-1015',
  RESTORE_POINT_AT: '2026-07-31T00:00:00.000Z',
  RELEASE_SHA: 'a'.repeat(40),
  RELEASE_MANIFEST_SHA256: 'b'.repeat(64),
} as const

const ZERO_RECOVERY = {
  sessionsInvalidated: 0,
  verificationTokensInvalidated: 0,
  invitationsCanceled: 0,
  outboxEventsFenced: 0,
  emailsCanceled: 0,
  digestBatchesTerminated: 0,
  repliesCanceled: 0,
  repliesMadeAmbiguous: 0,
  googleConnectionsFenced: 0,
  googleExecutionPermitsFenced: 0,
  googleSourceOperationsFenced: 0,
  googleRevokePermitsFenced: 0,
  legacyImportJobsCanceled: 0,
  legacyImportEffectLeasesReleased: 0,
  googleImportV2ParentsFenced: 0,
  googleImportV2ItemsFenced: 0,
  aiIssuedPermitsReleased: 0,
  aiConsumedPermitsMadeAmbiguous: 0,
  aiOperationsFenced: 0,
  aiBackfillRunsStalled: 0,
} as const

function memoryIO(): OperatorIO & { outLines: string[]; errLines: string[] } {
  const outLines: string[] = []
  const errLines: string[] = []
  return {
    outLines,
    errLines,
    out: (line) => void outLines.push(line),
    err: (line) => void errLines.push(line),
  }
}

function ctxFor(dryRun: boolean): OperatorContext {
  return {
    operatorId: 'op@example.com',
    correlationId: 'corr-1',
    dryRun,
    decision: {
      allowed: true,
      reason: 'allowed',
      action: 'system:ops',
      policyVersion: 't',
    },
  }
}

const inspectionPlan = () => ({
  requestContent: '{"kind":"review-lifecycle-recovery"}\n',
  requestSha256: 'e'.repeat(64),
  reportContent: '{"lifecycle":{"expired":4}}\n',
  reportSha256: 'f'.repeat(64),
  expired: 4,
})

it('retries restore-verify when Review content expires after lifecycle completion', async () => {
  const startedAt = new Date('2026-08-28T10:00:00.000Z')
  let now = startedAt
  let binding: ReviewLifecycleRecoveryExecutionAuthorityInput | null = null
  const rows: ReviewSourceContentLifecycleInspection[] = [1, 2, 3].map((id) => ({
    reviewId: reviewId(`10000000-0000-4000-8000-${String(id).padStart(12, '0')}`),
    createdAt: new Date('2026-08-20T10:00:00.000Z'),
    sourceContentState: 'active',
    lifecycleClock: new Date(
      startedAt.getTime() + (id === 1 ? 1 : id === 2 ? -1 : 3) * 86_400_000,
    ),
    shadowFindings: [],
  }))
  const readPage: ReviewSourceContentLifecycleStore['readInspectionBatch'] = async ({
    after,
    limit,
  }) =>
    rows.filter((row) => after == null || row.reviewId > after.reviewId).slice(0, limit)
  const store: ReviewSourceContentLifecycleStore = {
    readInspectionBatch: readPage,
    applyLifecycleBatch: async (input) => {
      const page = await readPage(input)
      const before = page.map((row) => ({ ...row }))
      let redacted = 0
      for (const row of page) {
        if (
          row.sourceContentState === 'active' &&
          row.lifecycleClock! <= input.evaluatedAt
        ) {
          rows[rows.indexOf(row)] = { ...row, sourceContentState: 'source_expired' }
          redacted += 1
        }
      }
      return {
        rows: before,
        hasMore: false,
        rowsRedacted: redacted,
        legacyGoogleRepliesReconciled: 0,
      }
    },
  }
  const complete = vi.fn(async () => {})
  const factory = createReviewLifecycleRecoveryAuthorityFactory({
    clock: () => now,
    createRunLifecycle: (input) =>
      createRunReviewSourceContentLifecycle({ store, ...input }),
    createRecoveryRunId: () => '10000000-0000-4000-8000-000000000001',
    loadNextRecoveryGeneration: async () => 1,
    executions: {
      loadActive: async () => binding,
      resume: async () =>
        binding == null
          ? null
          : {
              state: 'lifecycle_applied',
              reportExpired: 1,
              checkpoint: null,
              pages: 1,
              scanned: 3,
              rowsRedacted: 1,
              legacyGoogleRepliesReconciled: 0,
            },
      begin: async (input) => {
        binding = input
        return {
          state: 'applying',
          resumed: false,
          reportExpired: 1,
          checkpoint: null,
          pages: 0,
          scanned: 0,
          rowsRedacted: 0,
          legacyGoogleRepliesReconciled: 0,
        }
      },
      complete,
      fail: async () => {},
    },
  })
  const authority = () =>
    factory.createAuthority({ environmentConfirmation: 'closed-beta-v2' })
  const deps = depsFor({
    clock: () => now,
    reviewLifecycle: authority(),
    countExpired: async () =>
      rows.filter(
        (row) => row.sourceContentState === 'active' && row.lifecycleClock! <= now,
      ).length,
  })
  const interrupted = new Error('interrupted before the fence')
  deps.applyRecoveryFence.mockRejectedValueOnce(interrupted)
  await expect(runRestoreVerifyAction(ctxFor(false), deps, memoryIO())).rejects.toBe(
    interrupted,
  )
  expect(complete).not.toHaveBeenCalled()
  const originalBinding = binding

  now = new Date('2026-08-30T10:00:00.000Z')
  expect(await deps.countExpired()).toBe(1)
  const io = memoryIO()
  expect(
    await runRestoreVerifyAction(
      ctxFor(false),
      { ...deps, reviewLifecycle: authority() },
      io,
    ),
  ).toBe(0)
  expect(io.errLines).toEqual([])
  expect(await deps.countExpired()).toBe(0)
  expect(rows.map((row) => row.sourceContentState)).toEqual([
    'source_expired',
    'source_expired',
    'active',
  ])
  expect(binding).toEqual(originalBinding)
  expect(complete).toHaveBeenCalledOnce()
})

it('keeps the receipt unfinished if Review content expires while the fence commits', async () => {
  const deps = depsFor({
    countExpired: vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValue(1),
  })
  const io = memoryIO()
  expect(await runRestoreVerifyAction(ctxFor(false), deps, io)).toBe(1)
  expect(deps.applyRecoveryFence).toHaveBeenCalledOnce()
  expect(deps.reviewComplete).not.toHaveBeenCalled()
  expect(io.errLines.join('\n')).toContain('1 expired-content row(s) remain')
})

function depsFor(overrides: Partial<RestoreVerifyDeps> = {}): RestoreVerifyDeps & {
  reviewLifecycle: {
    kind: 'confirmed_apply'
    admit: ReturnType<typeof vi.fn>
  }
  reviewApply: ReturnType<typeof vi.fn>
  reviewComplete: ReturnType<typeof vi.fn>
  countExpired: ReturnType<typeof vi.fn>
  purgeEvidence: ReturnType<typeof vi.fn>
  inspectGoogleImportLifecycle: ReturnType<typeof vi.fn>
  sweepGoogleImportLifecycle: ReturnType<typeof vi.fn>
  inspectRetentionBacklog: ReturnType<typeof vi.fn>
  sweepRetentionBacklog: ReturnType<typeof vi.fn>
  inspectRecoveryFence: ReturnType<typeof vi.fn>
  applyRecoveryFence: ReturnType<typeof vi.fn>
} {
  const reviewApply = vi.fn(async () => {})
  const reviewComplete = vi.fn(async () => {})
  return {
    env: ISOLATED_ENV,
    confirmation: 'closed-beta-v2',
    clock: () => new Date('2026-11-07T10:00:00.000Z'),
    reviewLifecycle: {
      kind: 'confirmed_apply',
      admit: vi.fn(async () => ({
        recoveryInput: {
          runId: '10000000-0000-4000-8000-000000000001',
          generation: 1,
          sourceReleaseSha: ISOLATED_ENV.RELEASE_SHA,
          sourceManifestSha256: ISOLATED_ENV.RELEASE_MANIFEST_SHA256,
          restorePointAt: new Date(ISOLATED_ENV.RESTORE_POINT_AT),
          operatorId: 'op@example.com',
          correlationId: 'corr-1',
        },
        expired: 0,
        approvalId: 'REV-01-restore-approval',
        approvalBundleSha256: 'c'.repeat(64),
        reportSha256: 'd'.repeat(64),
        applyReviewLifecycle: reviewApply,
        complete: reviewComplete,
      })),
    },
    reviewApply,
    reviewComplete,
    countExpired: vi.fn(async () => 0),
    purgeEvidence: vi.fn(async () => [
      {
        subject: 'reviews.purge',
        rowsDeleted: 2,
        outcome: 'completed',
        startedAt: '2026-07-31T00:00:00.000Z',
      },
    ]),
    inspectGoogleImportLifecycle: vi.fn(async () => ({
      expiredItems: 0,
      purgeCandidates: 0,
      unreleasedExpiredReceipts: 0,
    })),
    sweepGoogleImportLifecycle: vi.fn(async () => {}),
    inspectRetentionBacklog: vi.fn(async () => ({})),
    sweepRetentionBacklog: vi.fn(async () => {}),
    inspectRecoveryFence: vi.fn(async () => ZERO_RECOVERY),
    applyRecoveryFence: vi.fn(async () => ({
      id: '10000000-0000-4000-8000-000000000001',
      generation: 1,
      replayed: false,
      counts: ZERO_RECOVERY,
      completedAt: new Date('2026-07-31T00:01:00.000Z'),
    })),
    ...overrides,
  } as RestoreVerifyDeps & {
    reviewLifecycle: {
      kind: 'confirmed_apply'
      admit: ReturnType<typeof vi.fn>
    }
    reviewApply: ReturnType<typeof vi.fn>
    reviewComplete: ReturnType<typeof vi.fn>
    countExpired: ReturnType<typeof vi.fn>
    purgeEvidence: ReturnType<typeof vi.fn>
    inspectGoogleImportLifecycle: ReturnType<typeof vi.fn>
    sweepGoogleImportLifecycle: ReturnType<typeof vi.fn>
    inspectRetentionBacklog: ReturnType<typeof vi.fn>
    sweepRetentionBacklog: ReturnType<typeof vi.fn>
    inspectRecoveryFence: ReturnType<typeof vi.fn>
    applyRecoveryFence: ReturnType<typeof vi.fn>
  }
}

describe('ops:restore-verify spec contract (BQC-7.8)', () => {
  const base = { operator: 'op@example.com' }

  it('requires --reason with --apply', () => {
    const args = { ...base, apply: true, yes: 'closed-beta-v2' }
    expect(validateOperatorArgs(RESTORE_VERIFY_SPEC, args as never)).toMatch(/--reason/)
  })

  it('requires the typed confirmation --yes closed-beta-v2 with --apply', () => {
    const args = { ...base, apply: true, reason: 'drill', yes: 'ops:purge' }
    expect(validateOperatorArgs(RESTORE_VERIFY_SPEC, args as never)).toMatch(
      /--yes closed-beta-v2/,
    )
  })

  it('accepts the full apply invocation and the plain read', () => {
    expect(
      validateOperatorArgs(RESTORE_VERIFY_SPEC, {
        ...base,
        apply: true,
        reason: 'restore drill 2026-07-31',
        yes: 'closed-beta-v2',
      } as never),
    ).toBeNull()
    expect(validateOperatorArgs(RESTORE_VERIFY_SPEC, base as never)).toBeNull()
  })

  it('declares NO capability — it must run while every capability is off', () => {
    expect(RESTORE_VERIFY_SPEC.capability).toBeUndefined()
    expect(RESTORE_VERIFY_SPEC.mutation).toBe(true)
    expect(RESTORE_VERIFY_SPEC.destructive).toBe(true)
  })

  // The harness refuses before it opens a database or a queue only for a spec
  // that says so; a restore command without the flag would boot first.
  it.each([RESTORE_VERIFY_SPEC, RESTORE_PREFLIGHT_SPEC])(
    '$name is fenced by the isolated-restore boot check',
    (spec) => {
      expect(spec.isolatedRestore).toBe(true)
    },
  )
})

describe('runRestoreVerifyAction (BQC-7.8)', () => {
  it.each([undefined, '', 'production', 'closed-beta-v2 '])(
    'refuses confirmation %s before any mutation',
    async (confirmation) => {
      const deps = depsFor({ confirmation })
      const io = memoryIO()
      expect(await runRestoreVerifyAction(ctxFor(false), deps, io)).toBe(1)
      expect(io.errLines.join('\n')).toContain('--yes closed-beta-v2')
      expect(deps.reviewLifecycle.admit).not.toHaveBeenCalled()
      expect(deps.reviewApply).not.toHaveBeenCalled()
      expect(deps.sweepGoogleImportLifecycle).not.toHaveBeenCalled()
      expect(deps.sweepRetentionBacklog).not.toHaveBeenCalled()
      expect(deps.applyRecoveryFence).not.toHaveBeenCalled()
    },
  )

  it('logs the confirmed environment, operator and time before admitting mutation', async () => {
    const deps = depsFor()
    const io = memoryIO()
    deps.reviewLifecycle.admit.mockImplementationOnce(async () => {
      expect(io.outLines).toContain(
        'restore confirmation — environment=closed-beta-v2 operator=op@example.com at=2026-11-07T10:00:00.000Z correlation=corr-1',
      )
      throw new Error('stop after confirmation')
    })
    await expect(runRestoreVerifyAction(ctxFor(false), deps, io)).rejects.toThrow(
      'stop after confirmation',
    )
  })

  it('logs the current confirmer separately from the resumed fence identity', async () => {
    const deps = depsFor()
    const io = memoryIO()
    const ctx = {
      ...ctxFor(false),
      operatorId: 'confirmer@example.com',
      correlationId: 'next-invocation',
    }

    expect(await runRestoreVerifyAction(ctx, deps, io)).toBe(0)
    expect(io.outLines).toContain(
      'restore confirmation — environment=closed-beta-v2 operator=confirmer@example.com at=2026-11-07T10:00:00.000Z correlation=next-invocation',
    )
    expect(deps.reviewLifecycle.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorId: ctx.operatorId,
        correlationId: ctx.correlationId,
      }),
    )
    expect(deps.applyRecoveryFence).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ operatorId: 'op@example.com', correlationId: 'corr-1' }),
    )
    expect(deps.reviewComplete).toHaveBeenCalledOnce()
  })

  // Planted faults: the verifier is started from an environment that carries a
  // live Redis, queue or bucket setting. It refuses before it inspects or
  // changes anything, and names the setting without printing its value.
  it.each([
    [
      'production Redis',
      'REDIS_URL',
      'redis://default:live-secret@redis.railway.internal:6379',
    ],
    [
      'production queue namespace',
      'QUEUE_REDIS_URL',
      'redis://default:live-secret@queue-redis.railway.internal:6379',
    ],
    [
      'production bucket endpoint',
      'S3_INTERNAL_ENDPOINT',
      'https://live-bucket.storageapi.dev',
    ],
    ['production bucket', 'AWS_S3_BUCKET_NAME', 'live-bucket-name'],
  ])(
    'refuses a %s (%s) before any inspection or mutation',
    async (_label, name, value) => {
      for (const dryRun of [true, false]) {
        const deps = depsFor({ env: { ...ISOLATED_ENV, [name]: value } })
        const io = memoryIO()

        expect(await runRestoreVerifyAction(ctxFor(dryRun), deps, io)).toBe(1)
        expect(io.errLines.join('\n')).toContain(name)
        expect(io.errLines.join('\n')).not.toContain(value)
        expect(io.outLines).toEqual([])
        expect(deps.countExpired).not.toHaveBeenCalled()
        expect(deps.inspectGoogleImportLifecycle).not.toHaveBeenCalled()
        expect(deps.inspectRetentionBacklog).not.toHaveBeenCalled()
        expect(deps.inspectRecoveryFence).not.toHaveBeenCalled()
        expect(deps.reviewLifecycle.admit).not.toHaveBeenCalled()
        expect(deps.reviewApply).not.toHaveBeenCalled()
        expect(deps.sweepGoogleImportLifecycle).not.toHaveBeenCalled()
        expect(deps.sweepRetentionBacklog).not.toHaveBeenCalled()
        expect(deps.applyRecoveryFence).not.toHaveBeenCalled()
      }
    },
  )

  it('REFUSES when RESTORE_MODE is not isolated — nothing is purged', async () => {
    const io = memoryIO()
    const deps = depsFor({ env: { DATABASE_URL: ISOLATED_ENV.DATABASE_URL } })
    const code = await runRestoreVerifyAction(ctxFor(false), deps, io)
    expect(code).toBe(1)
    expect(io.errLines.join('\n')).toMatch(/RESTORE_MODE=isolated/)
    expect(deps.reviewLifecycle.admit).not.toHaveBeenCalled()
    expect(deps.applyRecoveryFence).not.toHaveBeenCalled()
  })

  it('REFUSES a non-isolated DATABASE_URL — nothing is purged', async () => {
    const io = memoryIO()
    const deps = depsFor({
      env: {
        RESTORE_MODE: 'isolated',
        DATABASE_URL: 'postgresql://u:p@db.prod.example/x',
      },
    })
    const code = await runRestoreVerifyAction(ctxFor(false), deps, io)
    expect(code).toBe(1)
    expect(io.errLines.join('\n')).toMatch(/not an admitted restore target/)
    expect(deps.reviewLifecycle.admit).not.toHaveBeenCalled()
    expect(deps.applyRecoveryFence).not.toHaveBeenCalled()
  })

  // Replay of the erasures a restore undid is not wired into the command. It
  // says so on every run and never lists replay among the things it verified.
  it('says on a dry run and on an apply that erasure replay is not wired', async () => {
    for (const dryRun of [true, false]) {
      const io = memoryIO()
      const deps = depsFor({ countExpired: vi.fn().mockResolvedValue(0) })

      expect(await runRestoreVerifyAction(ctxFor(dryRun), deps, io)).toBe(0)

      expect(io.outLines.join('\n')).toContain(RESTORE_VERIFY_REPLAY_NOTICE)
    }
    // The wording is part of the contract: it must stay a plain statement that
    // nothing is replayed, not something an operator could read as reassurance.
    expect(RESTORE_VERIFY_REPLAY_NOTICE).toMatch(/^NOT WIRED: erasure replay/)
    expect(RESTORE_VERIFY_REPLAY_NOTICE).toMatch(/does not re-apply/)
  })

  it('never claims that erasures were replayed or verified', async () => {
    const io = memoryIO()
    const deps = depsFor({ countExpired: vi.fn().mockResolvedValue(0) })

    expect(await runRestoreVerifyAction(ctxFor(false), deps, io)).toBe(0)

    const claims = io.outLines.filter((line) => line.startsWith('✓'))
    expect(claims.length).toBeGreaterThan(0)
    expect(claims.filter((line) => /erasure|replay/iu.test(line))).toEqual([])
    expect(io.outLines.join('\n')).toMatch(/Re-apply by hand every erasure/)
  })

  it('dry-run reports the eligible count and purges nothing', async () => {
    const io = memoryIO()
    const deps = depsFor({ countExpired: vi.fn(async () => 7) })
    const code = await runRestoreVerifyAction(ctxFor(true), deps, io)
    expect(code).toBe(0)
    expect(deps.reviewLifecycle.admit).not.toHaveBeenCalled()
    expect(deps.applyRecoveryFence).not.toHaveBeenCalled()
    const out = io.outLines.join('\n')
    expect(out).toMatch(/RESTORE MODE ISOLATED/)
    expect(out).toMatch(/7 expired-content row\(s\)/)
    expect(out).toMatch(/--apply --yes closed-beta-v2/)
  })

  it('inspection-only dry-run reports that apply authority is unavailable', async () => {
    const io = memoryIO()
    const deps = depsFor({
      reviewLifecycle: {
        kind: 'inspection_only',
        reason: 'environment_confirmation_required',
        prepare: vi.fn(async () => inspectionPlan()),
      },
    })

    const code = await runRestoreVerifyAction(ctxFor(true), deps, io)

    expect(code).toBe(0)
    expect(io.outLines.join('\n')).toMatch(/apply remains unavailable/i)
    expect(io.outLines.join('\n')).not.toMatch(/re-run with --apply/)
    expect(io.outLines.join('\n')).toContain('e'.repeat(64))
    expect(io.outLines.join('\n')).toContain('f'.repeat(64))
    expect(io.outLines.join('\n')).toContain('--yes closed-beta-v2')
    expect(deps.countExpired).not.toHaveBeenCalled()
  })

  it('inspection-only apply refuses before any lifecycle or recovery mutation', async () => {
    const io = memoryIO()
    const deps = depsFor({
      reviewLifecycle: {
        kind: 'inspection_only',
        reason: 'environment_confirmation_required',
        prepare: vi.fn(async () => inspectionPlan()),
      },
    })

    const code = await runRestoreVerifyAction(ctxFor(false), deps, io)

    expect(code).toBe(1)
    expect(deps.countExpired).not.toHaveBeenCalled()
    expect(deps.sweepGoogleImportLifecycle).not.toHaveBeenCalled()
    expect(deps.sweepRetentionBacklog).not.toHaveBeenCalled()
    expect(deps.applyRecoveryFence).not.toHaveBeenCalled()
    expect(io.errLines.join('\n')).toMatch(/no environment confirmation/i)
  })

  it('apply runs the purge in-process, prints evidence, and exits 0 when nothing remains', async () => {
    const io = memoryIO()
    const deps = depsFor({
      countExpired: vi.fn().mockResolvedValue(0).mockResolvedValueOnce(2),
    })
    const code = await runRestoreVerifyAction(ctxFor(false), deps, io)
    expect(code).toBe(0)
    expect(deps.reviewLifecycle.admit).toHaveBeenCalledTimes(1)
    expect(deps.reviewApply).toHaveBeenCalledTimes(1)
    expect(deps.reviewComplete).toHaveBeenCalledTimes(1)
    expect(deps.sweepRetentionBacklog).toHaveBeenCalledTimes(1)
    expect(deps.purgeEvidence).toHaveBeenCalledTimes(1)
    expect(deps.applyRecoveryFence).toHaveBeenCalledTimes(1)
    const out = io.outLines.join('\n')
    expect(out).toMatch(/reviews\.purge/)
    expect(out).toMatch(/rows_deleted=2/)
    expect(out).toMatch(/zero expired-content row\(s\) remain/)
    expect(out).toMatch(/recovery generation 1 completed/)
    expect(out).toContain(
      'restore confirmation — environment=closed-beta-v2 operator=op@example.com at=2026-11-07T10:00:00.000Z correlation=corr-1',
    )
    // Cutover reminder: RESTORE_MODE must be UNSET.
    expect(out).toMatch(/UNSET RESTORE_MODE/)
  })

  it('apply fails when Google import lifecycle backlog remains', async () => {
    const io = memoryIO()
    const deps = depsFor({
      inspectGoogleImportLifecycle: vi
        .fn()
        .mockResolvedValueOnce({
          expiredItems: 1,
          purgeCandidates: 0,
          unreleasedExpiredReceipts: 0,
        })
        .mockResolvedValueOnce({
          expiredItems: 0,
          purgeCandidates: 0,
          unreleasedExpiredReceipts: 1,
        }),
    })

    const code = await runRestoreVerifyAction(ctxFor(false), deps, io)

    expect(code).toBe(1)
    expect(deps.sweepGoogleImportLifecycle).toHaveBeenCalledTimes(1)
    expect(deps.applyRecoveryFence).not.toHaveBeenCalled()
    expect(io.errLines.join('\n')).toMatch(/Google import lifecycle backlog/)
  })

  it('apply exits 1 when expired rows remain after the purge', async () => {
    const io = memoryIO()
    const deps = depsFor({
      countExpired: vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(1),
    })
    const code = await runRestoreVerifyAction(ctxFor(false), deps, io)
    expect(code).toBe(1)
    expect(deps.applyRecoveryFence).not.toHaveBeenCalled()
    expect(io.errLines.join('\n')).toMatch(/1 expired-content row\(s\) remain/)
  })

  it('fails closed when the bounded retention sweep leaves overdue rows', async () => {
    const io = memoryIO()
    const deps = depsFor({
      inspectRetentionBacklog: vi
        .fn()
        .mockResolvedValueOnce({ 'scan_events.guest_session_pseudonym': 4 })
        .mockResolvedValueOnce({ 'scan_events.guest_session_pseudonym': 1 }),
    })

    const code = await runRestoreVerifyAction(ctxFor(false), deps, io)

    expect(code).toBe(1)
    expect(deps.sweepRetentionBacklog).toHaveBeenCalledTimes(1)
    expect(deps.applyRecoveryFence).not.toHaveBeenCalled()
    expect(io.errLines.join('\n')).toMatch(/overdue retention backlog remains/)
  })

  it('fails closed when the recovery fence leaves resurrected authority', async () => {
    const io = memoryIO()
    const deps = depsFor({
      inspectRecoveryFence: vi
        .fn()
        .mockResolvedValueOnce({ ...ZERO_RECOVERY, sessionsInvalidated: 3 })
        .mockResolvedValueOnce({ ...ZERO_RECOVERY, sessionsInvalidated: 1 }),
    })

    const code = await runRestoreVerifyAction(ctxFor(false), deps, io)

    expect(code).toBe(1)
    expect(deps.applyRecoveryFence).toHaveBeenCalledTimes(1)
    expect(io.errLines.join('\n')).toMatch(/restored authority remains/)
  })
})
