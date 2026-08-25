// BQC-7.8 — ops:restore-verify command core (unit).
//
// The restore drill's verification step, run inside the isolated restored
// environment BEFORE cutover: hard-requires RESTORE_MODE=isolated + an
// isolated (loopback) DATABASE_URL, runs the source-policy purge in-process
// (the purge job's core — never via BullMQ), asserts zero expired-content
// rows remain eligible, prints the retention_runs evidence, and reminds the
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

function depsFor(overrides: Partial<RestoreVerifyDeps> = {}): RestoreVerifyDeps & {
  countExpired: ReturnType<typeof vi.fn>
  purgeExpired: ReturnType<typeof vi.fn>
  purgeEvidence: ReturnType<typeof vi.fn>
  inspectGoogleImportLifecycle: ReturnType<typeof vi.fn>
  sweepGoogleImportLifecycle: ReturnType<typeof vi.fn>
} {
  return {
    env: ISOLATED_ENV,
    countExpired: vi.fn(async () => 0),
    purgeExpired: vi.fn(async () => {}),
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
    ...overrides,
  } as RestoreVerifyDeps & {
    countExpired: ReturnType<typeof vi.fn>
    purgeExpired: ReturnType<typeof vi.fn>
    purgeEvidence: ReturnType<typeof vi.fn>
    inspectGoogleImportLifecycle: ReturnType<typeof vi.fn>
    sweepGoogleImportLifecycle: ReturnType<typeof vi.fn>
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
    expect(deps.purgeExpired).not.toHaveBeenCalled()
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
    expect(io.errLines.join('\n')).toMatch(/not an isolated/)
    expect(deps.purgeExpired).not.toHaveBeenCalled()
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
    expect(deps.purgeExpired).not.toHaveBeenCalled()
  })

  it('dry-run reports the eligible count and purges nothing', async () => {
    const io = memoryIO()
    const deps = depsFor({ countExpired: vi.fn(async () => 7) })
    const code = await runRestoreVerifyAction(ctxFor(true), deps, io)
    expect(code).toBe(0)
    expect(deps.purgeExpired).not.toHaveBeenCalled()
    const out = io.outLines.join('\n')
    expect(out).toMatch(/RESTORE MODE ISOLATED/)
    expect(out).toMatch(/7 expired-content row\(s\)/)
    expect(out).toMatch(/--apply --yes ops:restore-verify/)
  })

  it('apply runs the purge in-process, prints evidence, and exits 0 when nothing remains', async () => {
    const io = memoryIO()
    const deps = depsFor({
      countExpired: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0),
    })
    const code = await runRestoreVerifyAction(ctxFor(false), deps, io)
    expect(code).toBe(0)
    expect(deps.purgeExpired).toHaveBeenCalledTimes(1)
    expect(deps.purgeEvidence).toHaveBeenCalledTimes(1)
    const out = io.outLines.join('\n')
    expect(out).toMatch(/reviews\.purge/)
    expect(out).toMatch(/rows_deleted=2/)
    expect(out).toMatch(/zero expired-content row\(s\) remain/)
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
    expect(io.errLines.join('\n')).toMatch(/Google import lifecycle backlog/)
  })

  it('apply exits 1 when expired rows remain after the purge', async () => {
    const io = memoryIO()
    const deps = depsFor({
      countExpired: vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(1),
    })
    const code = await runRestoreVerifyAction(ctxFor(false), deps, io)
    expect(code).toBe(1)
    expect(io.errLines.join('\n')).toMatch(/1 expired-content row\(s\) remain/)
  })
})
