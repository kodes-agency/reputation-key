// The operator command contract for acknowledging a job family's repair:
//
//   pnpm ops jobs acknowledge-repair <jobName> --operator <id>
//     [--reason <text> --apply]
//
// What the command does, and why it refuses, lives in
// src/shared/jobs/repair-acknowledgement.ts. This module is the invocation: the
// spec the harness runs it under, the arguments, and what it prints. It sits
// here, not in `scripts/ops/job-repair.ts`, because `scripts/**` is wiring only.
//
// The harness stores neither the operator nor the reason, and the family's head
// holds one timestamp for the acknowledgement. So the printed record is the
// audit trail: an applied run prints the operator, the reason and the
// correlation id beside the head's fields before and after, and the operator
// copies it into the incident record.

import type {
  JobRepairAcknowledger,
  JobRepairAssessment,
} from '#/shared/jobs/repair-acknowledgement'
import type {
  OperatorArgs,
  OperatorCommandSpec,
  OperatorContext,
  OperatorIO,
} from './operator-command'

const JOB_REPAIR_COMMAND = 'ops:jobs'
const ACTION = 'acknowledge-repair'

/**
 * A mutation, so it reports by default and `--apply` needs a reason. Not
 * destructive: it writes one timestamp, keeps every failure on record, and is
 * undone by nothing a later failure does not also do.
 */
export const jobRepairCommandSpec: OperatorCommandSpec = Object.freeze({
  name: JOB_REPAIR_COMMAND,
  scope: 'global',
  mutation: true,
  usage: `pnpm ops jobs ${ACTION} <jobName> --operator <id> [--reason <text> --apply]`,
})

type JobRepairPlan =
  Readonly<{ ok: true; jobName: string }> | Readonly<{ ok: false; error: string }>

export function planJobRepairCommand(args: OperatorArgs): JobRepairPlan {
  const [action, jobName, ...extra] = args.positionals
  if (action !== ACTION) {
    return { ok: false, error: `the only action is '${ACTION}'` }
  }
  if (!jobName) return { ok: false, error: '<jobName> is required' }
  if (extra.length > 0) return { ok: false, error: 'one <jobName> at a time' }
  return { ok: true, jobName }
}

const BLOCKED_NEXT_STEPS = {
  deadLetters:
    'discard or redrive each dead letter first: `pnpm ops quarantine discard <id>` ' +
    '(or `redrive <id>`) --operator <registered-operator>, runbooks §14',
  unrecoveredFailures:
    'a retained failed job is newer than the latest success, so the cause is not ' +
    'shown to be fixed: acknowledge after a later run of the family succeeds',
} as const

function printRefusal(
  io: OperatorIO,
  jobName: string,
  assessment: JobRepairAssessment,
): void {
  switch (assessment.outcome) {
    case 'unknown_job':
      io.err(
        `no governed job family named '${jobName}'. The families are: ${assessment.knownJobs.join(', ')}`,
      )
      return
    case 'no_runtime_head':
      io.err(
        `'${jobName}' has no runtime head: no worker has booted with it, so there is no failure to acknowledge`,
      )
      return
    case 'blocked': {
      const { deadLetterIds, unrecoveredFailures } = assessment.blockers
      io.err(`refused: '${jobName}' still has failures an operator can see.`)
      if (deadLetterIds.length > 0) {
        io.err(
          `  ${String(deadLetterIds.length)} dead letter(s): ${deadLetterIds.join(', ')}`,
        )
        io.err(`  ${BLOCKED_NEXT_STEPS.deadLetters}`)
      }
      if (unrecoveredFailures > 0) {
        io.err(
          `  ${String(unrecoveredFailures)} retained failed job(s) newer than the latest success`,
        )
        io.err(`  ${BLOCKED_NEXT_STEPS.unrecoveredFailures}`)
      }
      return
    }
    case 'nothing_to_acknowledge':
    case 'acknowledgeable':
      return
  }
}

function print(io: OperatorIO, record: object): void {
  io.out(JSON.stringify(record, null, 2))
}

/** What a read, or a refused or idle apply, tells the operator. */
function report(
  io: OperatorIO,
  jobName: string,
  assessment: JobRepairAssessment,
): number {
  switch (assessment.outcome) {
    case 'acknowledgeable':
      print(io, {
        jobName,
        outcome: 'would_acknowledge',
        set: { lastRepairAt: assessment.setsLastRepairAt },
        family: assessment.family,
      })
      io.out(
        `report only — re-run with --reason <text> --apply to set lastRepairAt on '${jobName}' ` +
          `to ${assessment.setsLastRepairAt}, the failure it setsLastRepairAt. A failure after that time stays latched.`,
      )
      return 0
    case 'nothing_to_acknowledge':
      print(io, { jobName, outcome: assessment.outcome, family: assessment.family })
      if (!assessment.family.ready) {
        io.out(
          `'${jobName}' is still unready (${assessment.family.reasons.join(', ')}); ` +
            'this command setsLastRepairAt only a failed on-demand run',
        )
      }
      return 0
    case 'blocked':
      print(io, {
        jobName,
        outcome: assessment.outcome,
        blockers: assessment.blockers,
        family: assessment.family,
      })
      printRefusal(io, jobName, assessment)
      return 1
    case 'unknown_job':
    case 'no_runtime_head':
      print(io, { jobName, outcome: assessment.outcome })
      printRefusal(io, jobName, assessment)
      return 1
  }
}

type RunInput = Readonly<{
  ctx: Pick<OperatorContext, 'dryRun' | 'operatorId' | 'correlationId' | 'reason'>
  jobName: string
  acknowledger: JobRepairAcknowledger
  io: OperatorIO
}>

/** Report, or with `--apply` acknowledge. Returns the exit code: 1 when refused. */
export async function runJobRepairCommand(input: RunInput): Promise<number> {
  const { ctx, jobName, acknowledger, io } = input
  if (ctx.dryRun) return report(io, jobName, await acknowledger.assess(jobName))

  const result = await acknowledger.acknowledge(jobName)
  if (!result.written) return report(io, jobName, result.assessment)
  const { after } = result
  print(io, {
    jobName,
    outcome: 'acknowledged',
    operator: ctx.operatorId,
    reason: ctx.reason,
    correlationId: ctx.correlationId,
    before: result.before,
    after: 'family' in after ? { outcome: after.outcome, family: after.family } : after,
  })
  return 0
}
