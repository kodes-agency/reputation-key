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
import {
  validateOperatorArgs,
  type OperatorContext,
  type OperatorIO,
} from './operator-command'
import {
  RESTORE_VERIFY_SPEC,
  runRestoreVerifyAction,
  type RestoreVerifyDeps,
} from './restore-verify'

const ISOLATED_ENV = {
  RESTORE_MODE: 'isolated',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/restored',
  PROCESSING_CELL: 'us',
  RESTORE_SOURCE_CELL: 'us',
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

function depsFor(overrides: Partial<RestoreVerifyDeps> = {}): RestoreVerifyDeps & {
  reviewLifecycle: {
    kind: 'reviewed_apply'
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
    reviewLifecycle: {
      kind: 'reviewed_apply',
      admit: vi.fn(async () => ({
        recoveryInput: {
          dataCellId: 'us',
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
      kind: 'reviewed_apply'
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
    const args = { ...base, apply: true, yes: 'ops:restore-verify' }
    expect(validateOperatorArgs(RESTORE_VERIFY_SPEC, args as never)).toMatch(/--reason/)
  })

  it('requires the typed confirmation --yes ops:restore-verify with --apply', () => {
    const args = { ...base, apply: true, reason: 'drill', yes: 'ops:purge' }
    expect(validateOperatorArgs(RESTORE_VERIFY_SPEC, args as never)).toMatch(
      /--yes ops:restore-verify/,
    )
  })

  it('accepts the full apply invocation and the plain read', () => {
    expect(
      validateOperatorArgs(RESTORE_VERIFY_SPEC, {
        ...base,
        apply: true,
        reason: 'restore drill 2026-07-31',
        yes: 'ops:restore-verify',
      } as never),
    ).toBeNull()
    expect(validateOperatorArgs(RESTORE_VERIFY_SPEC, base as never)).toBeNull()
  })

  it('declares NO capability — it must run while every capability is off', () => {
    expect(RESTORE_VERIFY_SPEC.capability).toBeUndefined()
    expect(RESTORE_VERIFY_SPEC.mutation).toBe(true)
    expect(RESTORE_VERIFY_SPEC.destructive).toBe(true)
  })
})

describe('runRestoreVerifyAction (BQC-7.8)', () => {
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
        PROCESSING_CELL: 'us',
        RESTORE_SOURCE_CELL: 'us',
      },
    })
    const code = await runRestoreVerifyAction(ctxFor(false), deps, io)
    expect(code).toBe(1)
    expect(io.errLines.join('\n')).toMatch(/not an admitted restore target/)
    expect(deps.reviewLifecycle.admit).not.toHaveBeenCalled()
    expect(deps.applyRecoveryFence).not.toHaveBeenCalled()
  })

  it('REFUSES a backup from another Data Cell before reading or purging rows', async () => {
    const io = memoryIO()
    const deps = depsFor({
      env: {
        ...ISOLATED_ENV,
        RESTORE_SOURCE_CELL: 'europe',
      },
    })
    const code = await runRestoreVerifyAction(ctxFor(false), deps, io)
    expect(code).toBe(1)
    expect(io.errLines.join('\n')).toMatch(/exactly match PROCESSING_CELL/)
    expect(deps.countExpired).not.toHaveBeenCalled()
    expect(deps.reviewLifecycle.admit).not.toHaveBeenCalled()
    expect(deps.applyRecoveryFence).not.toHaveBeenCalled()
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
    expect(out).toMatch(/--apply --yes ops:restore-verify/)
  })

  it('inspection-only dry-run reports that apply authority is unavailable', async () => {
    const io = memoryIO()
    const deps = depsFor({
      reviewLifecycle: {
        kind: 'inspection_only',
        reason: 'reviewed_cutover_authority_required',
        prepare: vi.fn(async () => inspectionPlan()),
      },
    })

    const code = await runRestoreVerifyAction(ctxFor(true), deps, io)

    expect(code).toBe(0)
    expect(io.outLines.join('\n')).toMatch(/apply remains unavailable/i)
    expect(io.outLines.join('\n')).not.toMatch(/re-run with --apply/)
    expect(io.outLines.join('\n')).toContain('e'.repeat(64))
    expect(io.outLines.join('\n')).toContain('f'.repeat(64))
    expect(io.outLines.join('\n')).toMatch(/independent approver/i)
    expect(deps.countExpired).not.toHaveBeenCalled()
  })

  it('inspection-only apply refuses before any lifecycle or recovery mutation', async () => {
    const io = memoryIO()
    const deps = depsFor({
      reviewLifecycle: {
        kind: 'inspection_only',
        reason: 'reviewed_cutover_authority_required',
        prepare: vi.fn(async () => inspectionPlan()),
      },
    })

    const code = await runRestoreVerifyAction(ctxFor(false), deps, io)

    expect(code).toBe(1)
    expect(deps.countExpired).not.toHaveBeenCalled()
    expect(deps.sweepGoogleImportLifecycle).not.toHaveBeenCalled()
    expect(deps.sweepRetentionBacklog).not.toHaveBeenCalled()
    expect(deps.applyRecoveryFence).not.toHaveBeenCalled()
    expect(io.errLines.join('\n')).toMatch(/no reviewed cutover authority/i)
  })

  it('apply runs the purge in-process, prints evidence, and exits 0 when nothing remains', async () => {
    const io = memoryIO()
    const deps = depsFor({
      countExpired: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0),
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
