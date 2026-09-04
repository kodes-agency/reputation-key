// BQC-7.5 — operator command harness (unit).
//
// The invocation contract every scripts/ops/* command runs through: argument
// requirements per scope, dry-run default for mutations, --apply, typed
// confirmation for destructive commands, the named-operator policy
// evaluation (allow AND deny), and the per-invocation correlation id. The
// policy evaluation is injected — these tests never touch a database; the
// real wiring proof lives in the integration test
// (src/shared/jobs/infrastructure/repositories/operator-command.test.ts).

import { describe, it, expect, vi } from 'vitest'
import {
  OPERATOR_ACTION,
  parseOperatorArgs,
  positionalArgs,
  runOperatorCommand,
  validateOperatorArgs,
  type OperatorAction,
  type OperatorArgs,
  type OperatorCommandSpec,
  type OperatorIO,
  type OperatorRuntime,
} from './operator-command'
import type { DecisionRequest, ExecutionDecision } from '#/shared/auth/execution-policy'
import { getRequestContext } from '#/shared/observability/request-context'

const READ_SPEC: OperatorCommandSpec = {
  name: 'ops:inspect',
  scope: 'property',
  usage: 'pnpm ops:inspect ... --operator <id>',
}

const MUTATION_SPEC: OperatorCommandSpec = {
  name: 'ops:quarantine',
  scope: 'global',
  mutation: true,
  usage: 'pnpm ops:quarantine ... --operator <id> [--reason <text> --apply]',
}

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

function runtimeAllow(decision?: Partial<ExecutionDecision>): {
  runtime: OperatorRuntime
  decide: ReturnType<typeof vi.fn>
} {
  const decide = vi.fn(async (_request: DecisionRequest): Promise<ExecutionDecision> => {
    return {
      allowed: true,
      reason: 'allowed',
      action: OPERATOR_ACTION,
      policyVersion: 'bqc-7.5',
      ...decision,
    }
  })
  return {
    runtime: { decide, newCorrelationId: () => 'corr-unit-1' },
    decide,
  }
}

// ── Parsing ──────────────────────────────────────────────────────────

describe('parseOperatorArgs', () => {
  it('parses value flags, boolean flags, extra flags, and positionals', () => {
    const spec: OperatorCommandSpec = {
      ...MUTATION_SPEC,
      extraFlags: ['all-ambiguous'],
    }
    const result = parseOperatorArgs(
      [
        'redrive',
        'job-1',
        '--operator',
        'op@x.io',
        '--reason',
        'incident 42',
        '--org',
        'org-1',
        '--property',
        'prop-1',
        '--ticket',
        'T-7',
        '--batch-size',
        '50',
        '--apply',
        '--all-ambiguous',
      ],
      spec,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args).toMatchObject({
      operator: 'op@x.io',
      reason: 'incident 42',
      ticket: 'T-7',
      organizationId: 'org-1',
      organizations: ['org-1'],
      propertyId: 'prop-1',
      apply: true,
      batchSize: 50,
      positionals: ['redrive', 'job-1'],
    })
    expect(result.args.flags.has('all-ambiguous')).toBe(true)
  })

  it('collects repeated --org flags in order (last wins for organizationId)', () => {
    const result = parseOperatorArgs(
      ['--org', 'org-1', '--org', 'org-2', '--operator', 'op@x.io'],
      READ_SPEC,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args.organizations).toEqual(['org-1', 'org-2'])
    expect(result.args.organizationId).toBe('org-2')
  })

  it('rejects unknown flags and missing flag values', () => {
    const unknown = parseOperatorArgs(['--bogus'], READ_SPEC)
    expect(unknown).toMatchObject({ ok: false, error: "unknown flag '--bogus'" })

    const missing = parseOperatorArgs(['--reason'], READ_SPEC)
    expect(missing).toMatchObject({ ok: false, error: '--reason requires a value' })
  })

  it('rejects a non-integer --batch-size', () => {
    const result = parseOperatorArgs(['--batch-size', 'abc'], MUTATION_SPEC)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('--batch-size must be a positive integer')
  })
})

describe('positionalArgs', () => {
  it('strips harness flags and their values', () => {
    expect(
      positionalArgs([
        'pause',
        'background',
        '--operator',
        'op@x.io',
        '--apply',
        '--reason',
        'x',
      ]),
    ).toEqual(['pause', 'background'])
  })
})

// ── Validation ────────────────────────────────────────────────────────

function args(overrides: Partial<OperatorArgs> = {}): OperatorArgs {
  return {
    operator: 'op@x.io',
    organizations: [],
    apply: false,
    dryRunFlag: false,
    flags: new Set(),
    positionals: [],
    ...overrides,
  }
}

describe('validateOperatorArgs', () => {
  it('requires --operator for every command', () => {
    expect(validateOperatorArgs(READ_SPEC, args({ operator: '' }))).toContain(
      '--operator',
    )
  })

  it('requires --org for org scope and --org + --property for property scope', () => {
    const orgSpec: OperatorCommandSpec = { ...READ_SPEC, scope: 'org' }
    expect(validateOperatorArgs(orgSpec, args())).toContain('--org')
    expect(validateOperatorArgs(orgSpec, args({ organizationId: 'o' }))).toBeNull()

    expect(validateOperatorArgs(READ_SPEC, args({ organizationId: 'o' }))).toContain(
      '--property',
    )
    expect(
      validateOperatorArgs(READ_SPEC, args({ organizationId: 'o', propertyId: 'p' })),
    ).toBeNull()
  })

  it('mutations: --apply requires --reason; dry-run does not', () => {
    expect(validateOperatorArgs(MUTATION_SPEC, args({ apply: true }))).toContain(
      '--reason',
    )
    expect(validateOperatorArgs(MUTATION_SPEC, args())).toBeNull()
    expect(
      validateOperatorArgs(MUTATION_SPEC, args({ apply: true, reason: 'incident 42' })),
    ).toBeNull()
  })

  it('rejects --apply on read commands and --apply/--dry-run conflicts', () => {
    expect(
      validateOperatorArgs(
        READ_SPEC,
        args({ organizationId: 'o', propertyId: 'p', apply: true }),
      ),
    ).toContain('--apply is only valid for mutation')
    expect(
      validateOperatorArgs(MUTATION_SPEC, args({ apply: true, dryRunFlag: true })),
    ).toContain('conflict')
  })

  it('requires --ticket with --apply when the spec requires it', () => {
    const spec: OperatorCommandSpec = { ...MUTATION_SPEC, requiresTicket: true }
    expect(validateOperatorArgs(spec, args({ apply: true, reason: 'r' }))).toContain(
      '--ticket',
    )
    expect(
      validateOperatorArgs(spec, args({ apply: true, reason: 'r', ticket: 'T-1' })),
    ).toBeNull()
  })

  it('destructive commands require typed confirmation with --apply', () => {
    const spec: OperatorCommandSpec = { ...MUTATION_SPEC, destructive: true }
    expect(validateOperatorArgs(spec, args({ apply: true, reason: 'r' }))).toContain(
      '--yes ops:quarantine',
    )
    expect(
      validateOperatorArgs(spec, args({ apply: true, reason: 'r', yes: 'wrong' })),
    ).toContain('--yes ops:quarantine')
    expect(
      validateOperatorArgs(
        spec,
        args({ apply: true, reason: 'r', yes: 'ops:quarantine' }),
      ),
    ).toBeNull()
    // Dry-run needs no confirmation.
    expect(validateOperatorArgs(spec, args())).toBeNull()
  })

  it('bounds --batch-size to the spec', () => {
    const spec: OperatorCommandSpec = {
      ...MUTATION_SPEC,
      batchSize: { default: 100, max: 500 },
    }
    expect(validateOperatorArgs(spec, args({ batchSize: 501 }))).toContain('<= 500')
    expect(validateOperatorArgs(spec, args({ batchSize: 500 }))).toBeNull()
    expect(validateOperatorArgs(MUTATION_SPEC, args({ batchSize: 10 }))).toContain(
      'not supported',
    )
  })
})

// ── The runner ────────────────────────────────────────────────────────

describe('runOperatorCommand', () => {
  it('exits 1 with usage on parse errors — no policy evaluation', async () => {
    const { runtime, decide } = runtimeAllow()
    const io = memoryIO()
    const result = await runOperatorCommand(
      READ_SPEC,
      async () => {},
      runtime,
      ['--bogus'],
      io,
    )
    expect(result.exitCode).toBe(1)
    expect(decide).not.toHaveBeenCalled()
    expect(io.errLines.join('\n')).toContain('usage:')
  })

  it('exits 1 with usage when required args are missing — no policy evaluation', async () => {
    const { runtime, decide } = runtimeAllow()
    const io = memoryIO()
    const result = await runOperatorCommand(READ_SPEC, async () => {}, runtime, [], io)
    expect(result.exitCode).toBe(1)
    expect(decide).not.toHaveBeenCalled()
    expect(io.errLines.join('\n')).toContain('--operator')
  })

  it('read command: evaluates the named operator + scope and runs the action', async () => {
    const { runtime, decide } = runtimeAllow()
    const io = memoryIO()
    const action = vi.fn<OperatorAction>(async () => {})
    const result = await runOperatorCommand(
      READ_SPEC,
      action,
      runtime,
      ['--operator', 'op@x.io', '--org', 'org-1', '--property', 'prop-1'],
      io,
    )
    expect(result.exitCode).toBe(0)
    expect(result.correlationId).toBe('corr-unit-1')
    expect(decide).toHaveBeenCalledTimes(1)
    expect(decide.mock.calls[0][0]).toMatchObject({
      principal: { kind: 'operator', id: 'op@x.io' },
      action: OPERATOR_ACTION,
      organizationId: 'org-1',
      propertyId: 'prop-1',
      executionKind: 'operator',
      reason: 'read',
      correlationId: 'corr-unit-1',
    })
    expect(action).toHaveBeenCalledTimes(1)
    expect(action.mock.calls[0][0]).toMatchObject({
      operatorId: 'op@x.io',
      correlationId: 'corr-unit-1',
      dryRun: false,
    })
    expect(io.outLines.join('\n')).toContain('decision=allow')
  })

  it('uses the per-invocation correlation id as the operator command id', async () => {
    const { runtime } = runtimeAllow()
    const io = memoryIO()
    let commandId: string | undefined

    const result = await runOperatorCommand(
      MUTATION_SPEC,
      async () => {
        commandId = getRequestContext()?.commandId
      },
      runtime,
      ['--operator', 'op@x.io'],
      io,
    )

    expect(result.exitCode).toBe(0)
    expect(commandId).toBe('corr-unit-1')
  })

  it('mutation defaults to dry-run; --apply + --reason executes', async () => {
    const { runtime, decide } = runtimeAllow()
    const io = memoryIO()

    const dryRunCtx: Array<{ dryRun: boolean }> = []
    const dry = await runOperatorCommand(
      MUTATION_SPEC,
      async (ctx) => void dryRunCtx.push(ctx),
      runtime,
      ['--operator', 'op@x.io'],
      io,
    )
    expect(dry.exitCode).toBe(0)
    expect(dryRunCtx[0]).toMatchObject({ dryRun: true })
    expect(decide.mock.calls[0][0].reason).toBe('dry-run')
    expect(io.outLines.join('\n')).toContain('mode=dry-run')

    const applyCtx: Array<{ dryRun: boolean; reason?: string }> = []
    const applied = await runOperatorCommand(
      MUTATION_SPEC,
      async (ctx) => void applyCtx.push(ctx),
      runtime,
      ['--operator', 'op@x.io', '--reason', 'incident 42', '--apply'],
      io,
    )
    expect(applied.exitCode).toBe(0)
    expect(applyCtx[0]).toMatchObject({ dryRun: false, reason: 'incident 42' })
    expect(decide.mock.calls[1][0].reason).toBe('incident 42')
    expect(io.outLines.join('\n')).toContain('mode=apply')
  })

  it('deny: exits 1, skips the action, prints the typed reason + correlation', async () => {
    const { runtime } = runtimeAllow({
      allowed: false,
      reason: 'operator_not_registered',
    })
    const io = memoryIO()
    const action = vi.fn(async () => {})
    const result = await runOperatorCommand(
      READ_SPEC,
      action,
      runtime,
      ['--operator', 'stranger@x.io', '--org', 'o', '--property', 'p'],
      io,
    )
    expect(result.exitCode).toBe(1)
    expect(result.decision?.reason).toBe('operator_not_registered')
    expect(action).not.toHaveBeenCalled()
    expect(io.outLines.join('\n')).toContain('deny:operator_not_registered')
    expect(io.outLines.join('\n')).toContain('corr-unit-1')
  })

  it('action failure exits 1; a numeric action result is the exit code', async () => {
    const { runtime } = runtimeAllow()
    const io = memoryIO()

    const thrown = await runOperatorCommand(
      READ_SPEC,
      async () => {
        throw new Error('boom')
      },
      runtime,
      ['--operator', 'op@x.io', '--org', 'o', '--property', 'p'],
      io,
    )
    expect(thrown.exitCode).toBe(1)
    expect(io.errLines.join('\n')).toContain('boom')

    const coded = await runOperatorCommand(
      READ_SPEC,
      async () => 3,
      runtime,
      ['--operator', 'op@x.io', '--org', 'o', '--property', 'p'],
      io,
    )
    expect(coded.exitCode).toBe(3)
  })

  it('passes the spec capability and the bounded batch size into the evaluation/ctx', async () => {
    const { runtime, decide } = runtimeAllow()
    const io = memoryIO()
    const spec: OperatorCommandSpec = {
      name: 'ops:rebuild-projection',
      scope: 'org',
      mutation: true,
      capability: 'inbox.use',
      batchSize: { default: 200, max: 1000 },
      usage: '...',
    }
    const ctxs: Array<{ batchSize?: number }> = []
    await runOperatorCommand(
      spec,
      async (ctx) => void ctxs.push(ctx),
      runtime,
      ['--operator', 'op@x.io', '--org', 'org-1'],
      io,
    )
    expect(decide.mock.calls[0][0].capability).toBe('inbox.use')
    expect(ctxs[0]?.batchSize).toBe(200)
  })
})
