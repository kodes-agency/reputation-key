// `pnpm ops jobs acknowledge-repair`: the invocation contract and what it
// prints. What the acknowledgement does, and when it refuses, is proved against
// the real store in src/shared/jobs/repair-acknowledgement.test.ts; here the
// acknowledger is a stand-in so each verdict can be shown to the operator.

import { describe, expect, it, vi } from 'vitest'
import type {
  JobRepairAcknowledger,
  JobRepairAssessment,
  JobRepairFamily,
} from '#/shared/jobs/repair-acknowledgement'
import {
  OPERATOR_ACTION,
  parseOperatorArgs,
  runOperatorCommand,
  validateOperatorArgs,
  type OperatorIO,
  type OperatorRuntime,
} from './operator-command'
import {
  jobRepairCommandSpec,
  planJobRepairCommand,
  runJobRepairCommand,
} from './job-repair-command'

const JOB = 'sync-property-reviews'
const FAILED = '2026-10-19T08:00:00.000Z'

const FAMILY: JobRepairFamily = {
  jobName: JOB,
  posture: 'active',
  schedule: 'none',
  ready: false,
  reasons: ['repair_required'],
  lastSucceededAt: '2026-10-19T09:00:00.000Z',
  lastOnDemandFailureAt: FAILED,
  lastScheduleFailureAt: null,
  lastRepairAt: null,
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

function acknowledgerFor(assessment: JobRepairAssessment): JobRepairAcknowledger & {
  assess: ReturnType<typeof vi.fn>
  acknowledge: ReturnType<typeof vi.fn>
} {
  return {
    assess: vi.fn(async () => assessment),
    acknowledge: vi.fn(async () => ({ written: false as const, assessment })),
  }
}

const ACKNOWLEDGEABLE: JobRepairAssessment = {
  outcome: 'acknowledgeable',
  family: FAMILY,
  setsLastRepairAt: FAILED,
}

const CTX = {
  operatorId: 'op-1',
  correlationId: 'corr-1',
  reason: 'cause fixed in the release',
}

/** The JSON record a run printed. */
function printed(io: { outLines: string[] }): Record<string, unknown> {
  const text = io.outLines.find((line) => line.startsWith('{'))
  return JSON.parse(text ?? '{}') as Record<string, unknown>
}

describe('ops:jobs invocation contract', () => {
  const refusal = (argv: readonly string[]): string | null => {
    const parsed = parseOperatorArgs(argv, jobRepairCommandSpec)
    return parsed.ok
      ? validateOperatorArgs(jobRepairCommandSpec, parsed.args)
      : parsed.error
  }

  it('is a global mutation that is not destructive', () => {
    expect(jobRepairCommandSpec).toMatchObject({
      name: 'ops:jobs',
      scope: 'global',
      mutation: true,
    })
    expect(jobRepairCommandSpec.destructive).toBeUndefined()
  })

  it('reports for a named operator with no reason, and applies only with one', () => {
    const base = ['acknowledge-repair', JOB, '--operator', 'op-1']

    expect(refusal(base)).toBeNull()
    expect(refusal([...base, '--apply'])).toBe('--reason <text> is required with --apply')
    expect(refusal([...base, '--reason', 'cause fixed', '--apply'])).toBeNull()
    expect(refusal(['acknowledge-repair', JOB])).toContain('--operator <id> is required')
  })

  it('takes exactly the action and one job name', () => {
    const plan = (...positionals: string[]) =>
      planJobRepairCommand({ positionals } as never)

    expect(plan('acknowledge-repair', JOB)).toEqual({ ok: true, jobName: JOB })
    expect(plan('acknowledge', JOB)).toMatchObject({ ok: false })
    expect(plan('acknowledge-repair')).toEqual({
      ok: false,
      error: '<jobName> is required',
    })
    expect(plan('acknowledge-repair', JOB, 'other')).toMatchObject({ ok: false })
  })
})

describe('what ops:jobs acknowledge-repair prints', () => {
  it('reports what it would set and why the family is unready, and writes nothing', async () => {
    const io = memoryIO()
    const acknowledger = acknowledgerFor(ACKNOWLEDGEABLE)

    const code = await runJobRepairCommand({
      ctx: { ...CTX, dryRun: true },
      jobName: JOB,
      acknowledger,
      io,
    })

    expect(code).toBe(0)
    expect(acknowledger.acknowledge).not.toHaveBeenCalled()
    expect(printed(io)).toEqual({
      jobName: JOB,
      outcome: 'would_acknowledge',
      set: { lastRepairAt: FAILED },
      family: FAMILY,
    })
    expect(io.outLines.join('\n')).toContain(
      `report only — re-run with --reason <text> --apply to set lastRepairAt on '${JOB}' ` +
        `to ${FAILED}, the time of the failure it acknowledges. A failure after that time stays latched.`,
    )
  })

  it('on apply, records the operator, reason, correlation id and the head before and after', async () => {
    const io = memoryIO()
    const after: JobRepairAssessment = {
      outcome: 'nothing_to_acknowledge',
      family: { ...FAMILY, ready: true, reasons: [], lastRepairAt: FAILED },
    }
    const acknowledger: JobRepairAcknowledger = {
      assess: vi.fn(),
      acknowledge: vi.fn(async () => ({ written: true as const, before: FAMILY, after })),
    }

    const code = await runJobRepairCommand({
      ctx: { ...CTX, dryRun: false },
      jobName: JOB,
      acknowledger,
      io,
    })

    expect(code).toBe(0)
    expect(acknowledger.acknowledge).toHaveBeenCalledWith(JOB)
    expect(printed(io)).toEqual({
      jobName: JOB,
      outcome: 'acknowledged',
      operator: 'op-1',
      reason: 'cause fixed in the release',
      correlationId: 'corr-1',
      before: FAMILY,
      after: { outcome: 'nothing_to_acknowledge', family: after.family },
    })
  })

  it('refuses a blocked family with the dead letters to discard, and exits 1', async () => {
    const io = memoryIO()
    const blocked: JobRepairAssessment = {
      outcome: 'blocked',
      family: FAMILY,
      blockers: {
        deadLetterIds: ['quarantine:default:1', 'quarantine:default:2'],
        unrecoveredFailures: 1,
        failureNewerThanLatestSuccess: false,
      },
    }

    const code = await runJobRepairCommand({
      ctx: { ...CTX, dryRun: false },
      jobName: JOB,
      acknowledger: acknowledgerFor(blocked),
      io,
    })

    expect(code).toBe(1)
    expect(printed(io)).toMatchObject({ outcome: 'blocked', jobName: JOB })
    const refusal = io.errLines.join('\n')
    expect(refusal).toContain(
      '2 dead letter(s): quarantine:default:1, quarantine:default:2',
    )
    expect(refusal).toContain('pnpm ops quarantine discard')
    expect(refusal).toContain('1 retained failed job(s) newer than the latest success')
  })

  it('names only the blocker that applies', async () => {
    const io = memoryIO()

    await runJobRepairCommand({
      ctx: { ...CTX, dryRun: true },
      jobName: JOB,
      acknowledger: acknowledgerFor({
        outcome: 'blocked',
        family: FAMILY,
        blockers: {
          deadLetterIds: [],
          unrecoveredFailures: 2,
          failureNewerThanLatestSuccess: false,
        },
      }),
      io,
    })

    expect(io.errLines.join('\n')).not.toContain('dead letter')
    expect(io.errLines.join('\n')).toContain('2 retained failed job(s)')
  })

  it('refuses a failure newer than the latest success that no retained job shows', async () => {
    const io = memoryIO()
    const failedLater = '2026-10-19T10:00:00.000Z'

    const code = await runJobRepairCommand({
      ctx: { ...CTX, dryRun: true },
      jobName: JOB,
      acknowledger: acknowledgerFor({
        outcome: 'blocked',
        family: { ...FAMILY, lastOnDemandFailureAt: failedLater },
        blockers: {
          deadLetterIds: [],
          unrecoveredFailures: 0,
          failureNewerThanLatestSuccess: true,
        },
      }),
      io,
    })

    expect(code).toBe(1)
    const refusal = io.errLines.join('\n')
    expect(refusal).toContain(
      `its latest on-demand failure (${failedLater}) is newer than its latest success (${FAMILY.lastSucceededAt})`,
    )
    expect(refusal).toContain('acknowledge after a later run of the family succeeds')
    expect(refusal).not.toContain('dead letter')
    expect(refusal).not.toContain('retained failed job')
  })

  it('refuses an unknown job and lists the governed families', async () => {
    const io = memoryIO()

    const code = await runJobRepairCommand({
      ctx: { ...CTX, dryRun: false },
      jobName: 'sync-property-review',
      acknowledger: acknowledgerFor({
        outcome: 'unknown_job',
        knownJobs: ['health-check', JOB],
      }),
      io,
    })

    expect(code).toBe(1)
    expect(io.errLines.join('\n')).toContain(
      "no governed job family named 'sync-property-review'. The families are: health-check, sync-property-reviews",
    )
  })

  it('refuses a family with no runtime head', async () => {
    const io = memoryIO()

    const code = await runJobRepairCommand({
      ctx: { ...CTX, dryRun: true },
      jobName: JOB,
      acknowledger: acknowledgerFor({ outcome: 'no_runtime_head' }),
      io,
    })

    expect(code).toBe(1)
    expect(io.errLines.join('\n')).toContain('no runtime head')
  })

  it('succeeds with nothing to do, and says when the family is still unready for another reason', async () => {
    const io = memoryIO()

    const code = await runJobRepairCommand({
      ctx: { ...CTX, dryRun: false },
      jobName: JOB,
      acknowledger: acknowledgerFor({
        outcome: 'nothing_to_acknowledge',
        family: { ...FAMILY, reasons: ['scheduler_missing'] },
      }),
      io,
    })

    expect(code).toBe(0)
    expect(printed(io)).toMatchObject({ outcome: 'nothing_to_acknowledge' })
    expect(io.outLines.join('\n')).toContain(
      "'sync-property-reviews' is still unready (scheduler_missing); " +
        'this command acknowledges only a failed on-demand run',
    )
  })
})

describe('ops:jobs under the operator harness', () => {
  const runtime = (allowed: boolean): OperatorRuntime => ({
    decide: async () =>
      allowed
        ? {
            allowed: true,
            reason: 'allowed',
            action: OPERATOR_ACTION,
            policyVersion: 'v',
          }
        : {
            allowed: false,
            reason: 'operator_not_registered',
            action: OPERATOR_ACTION,
            policyVersion: 'v',
          },
    newCorrelationId: () => 'corr-harness-1',
  })
  const argv = (...rest: string[]) => [
    'acknowledge-repair',
    JOB,
    '--operator',
    'op-1',
    ...rest,
  ]
  const action = (acknowledger: JobRepairAcknowledger) =>
    vi.fn(async (ctx: Parameters<typeof runJobRepairCommand>[0]['ctx'], args, io) => {
      const plan = planJobRepairCommand(args)
      if (!plan.ok) throw new Error(plan.error)
      return runJobRepairCommand({ ctx, jobName: plan.jobName, acknowledger, io })
    })

  it('prints the operator, the decision and the mode, and applies with a reason', async () => {
    const io = memoryIO()
    const acknowledger = acknowledgerFor(ACKNOWLEDGEABLE)
    acknowledger.acknowledge.mockResolvedValue({
      written: true,
      before: FAMILY,
      after: { outcome: 'nothing_to_acknowledge', family: FAMILY },
    })

    const result = await runOperatorCommand(
      jobRepairCommandSpec,
      action(acknowledger),
      runtime(true),
      argv('--reason', 'cause fixed', '--apply'),
      io,
    )

    expect(result.exitCode).toBe(0)
    expect(io.outLines[0]).toBe(
      'ops:jobs — operator=op-1 correlation=corr-harness-1 decision=allow mode=apply',
    )
    expect(printed(io)).toMatchObject({
      outcome: 'acknowledged',
      operator: 'op-1',
      reason: 'cause fixed',
      correlationId: 'corr-harness-1',
    })
  })

  it('is a dry run without --apply, and does not reach the acknowledger for a write', async () => {
    const io = memoryIO()
    const acknowledger = acknowledgerFor(ACKNOWLEDGEABLE)

    const result = await runOperatorCommand(
      jobRepairCommandSpec,
      action(acknowledger),
      runtime(true),
      argv(),
      io,
    )

    expect(result.exitCode).toBe(0)
    expect(io.outLines[0]).toContain('mode=dry-run')
    expect(acknowledger.acknowledge).not.toHaveBeenCalled()
  })

  it('runs nothing for an operator the policy denies', async () => {
    const io = memoryIO()
    const acknowledger = acknowledgerFor(ACKNOWLEDGEABLE)

    const result = await runOperatorCommand(
      jobRepairCommandSpec,
      action(acknowledger),
      runtime(false),
      argv('--reason', 'cause fixed', '--apply'),
      io,
    )

    expect(result.exitCode).toBe(1)
    expect(io.outLines[0]).toContain('decision=deny:operator_not_registered')
    expect(acknowledger.assess).not.toHaveBeenCalled()
    expect(acknowledger.acknowledge).not.toHaveBeenCalled()
  })

  it('refuses --apply without a reason before it evaluates the policy', async () => {
    const io = memoryIO()
    const acknowledger = acknowledgerFor(ACKNOWLEDGEABLE)

    const result = await runOperatorCommand(
      jobRepairCommandSpec,
      action(acknowledger),
      runtime(true),
      argv('--apply'),
      io,
    )

    expect(result.exitCode).toBe(1)
    expect(io.errLines.join('\n')).toContain('--reason <text> is required with --apply')
    expect(acknowledger.acknowledge).not.toHaveBeenCalled()
  })
})
