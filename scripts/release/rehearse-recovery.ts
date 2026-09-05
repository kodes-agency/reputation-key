// REL-01 rollback / forward-fix — `pnpm release:rehearse-recovery`.
//
// A REPORT-FIRST orchestrator with a mandatory human pause.
//
//   pnpm release:rehearse-recovery -- --plan ...     writes the plan, stops.
//   (a human reads the plan and authorizes it BY ITS DIGEST)
//   pnpm release:rehearse-recovery -- --apply ...    consumes read-backs, emits.
//
// The two invocations are separated on purpose. `--plan` is pure: it reads a
// candidate binding and writes one plan file. It cannot mutate anything, and
// the command exits telling the operator exactly what to do next. `--apply`
// refuses to run unless the authorization it is given carries the sha256 of the
// plan file it is given — so the plan a human read and the plan that proceeds
// are the same bytes.
//
// This command NEVER performs the recovery. It spawns no process, opens no
// database connection, and calls no Railway API; the test beside it asserts the
// source contains no process-spawning surface at all. A point-in-time restore
// is issued by an operator against the platform, and the platform's own receipt
// is supplied here by path. An orchestrator that could issue the restore could
// also claim it happened; one that can only consume a platform receipt cannot.
//
// Reverse DDL is refused at plan build time (recovery-rehearsal-plan.ts) and the
// emitted evidence always records `reverseDdlExecuted: false`.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod/v4'
import {
  assembleRecoveryRehearsalEvidence,
  buildRecoveryRehearsalPlan,
  canonicalRecoveryRehearsalPlan,
  recoveryRehearsalTransition,
  RECOVERY_REHEARSAL_PHASES,
  type RecoveryRehearsalDependencyFile,
  type RecoveryRehearsalPhase,
} from '../../src/shared/release/recovery-rehearsal-plan'
import { canonicalRecoveryRehearsalEvidence } from '../../src/shared/release/recovery-rehearsal-evidence'
import {
  releaseCandidateBindingSchema,
  releaseEvidenceSha256,
} from '../../src/shared/release/candidate-bound-evidence'
import { writeContentAddressed, writeOnce } from '../../src/shared/release/write-once'

const COMMAND_NAME = 'release:rehearse-recovery'

export type RehearseRecoveryIo = Readonly<{
  out: (line: string) => void
  err: (line: string) => void
}>

const consoleIo: RehearseRecoveryIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
}

const authorizationSchema = z
  .object({
    version: z.literal('repkey-recovery-rehearsal-authorization-1'),
    planSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    operator: z.string().trim().min(1).max(256),
    reason: z.string().trim().min(1).max(1024),
    approvedAt: z.iso.datetime({ offset: false }),
  })
  .strict()

export type RehearseRecoveryDeps = Readonly<{
  io?: RehearseRecoveryIo
  now?: () => string
}>

function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function usage(): string {
  return [
    `Usage (step 1 — plan, mutates nothing):`,
    `  pnpm ${COMMAND_NAME} -- --plan \\`,
    '    --recovery-path=compatible_image_rollback|incompatible_data_restore \\',
    '    --candidate=<candidate-binding.json> --operator=<id> --change-record=<id> \\',
    '    --reviewer=<id> --reviewed-at=<ISO-8601> --output=<plan.json>',
    '',
    `Usage (step 2 — apply, after a human authorized the plan digest):`,
    `  pnpm ${COMMAND_NAME} -- --apply \\`,
    '    --plan-file=<plan.json> --authorization=<authorization.json> \\',
    '    --observations=<read-back.json> --platform-receipt=<receipt file> \\',
    '    --inputs-dir=<retained artifacts> --operator=<id> --reason="<text>" \\',
    '    --output=<recovery-rehearsal.json>',
  ].join('\n')
}

function runPlanMode(
  args: readonly string[],
  io: RehearseRecoveryIo,
  now: () => string,
): number {
  const required = [
    '--recovery-path',
    '--candidate',
    '--operator',
    '--change-record',
    '--reviewer',
    '--reviewed-at',
    '--output',
  ]
  const missing = required.filter((flag) => flagValue(args, flag) === undefined)
  if (missing.length > 0) {
    io.err(`${COMMAND_NAME} --plan needs ${missing.join(', ')}.`)
    io.err(usage())
    return 2
  }

  const recoveryPath = flagValue(args, '--recovery-path')
  if (
    recoveryPath !== 'compatible_image_rollback' &&
    recoveryPath !== 'incompatible_data_restore'
  ) {
    io.err(`${COMMAND_NAME}: --recovery-path=${recoveryPath} is not a recovery path.`)
    return 2
  }

  const outputPath = resolve(flagValue(args, '--output') ?? '')

  let candidate: z.infer<typeof releaseCandidateBindingSchema>
  try {
    const parsed = releaseCandidateBindingSchema.safeParse(
      JSON.parse(readFileSync(resolve(flagValue(args, '--candidate') ?? ''), 'utf8')),
    )
    if (!parsed.success) {
      io.err(`${COMMAND_NAME}: candidate binding is invalid:`)
      for (const issue of parsed.error.issues) {
        io.err(`  candidate.${issue.path.join('.')}: ${issue.message}`)
      }
      return 2
    }
    candidate = parsed.data
  } catch (error) {
    io.err(`${COMMAND_NAME}: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }

  const plan = buildRecoveryRehearsalPlan({
    recoveryPath,
    candidate,
    createdAt: now(),
    operator: {
      identity: flagValue(args, '--operator') ?? '',
      changeRecord: flagValue(args, '--change-record') ?? '',
      independentReviewer: flagValue(args, '--reviewer') ?? '',
      reviewedAt: flagValue(args, '--reviewed-at') ?? '',
    },
  })
  if (!plan.ok) {
    io.err(`${COMMAND_NAME}: refusing to emit the recovery plan:`)
    for (const error of plan.errors) io.err(`  ${error}`)
    return 1
  }

  // The exclusive create IS the refusal — there is no separate existence check
  // to race against. A plan that is already there ends the run.
  const emitted = writeOnce(outputPath, canonicalRecoveryRehearsalPlan(plan.plan))
  if (emitted.status === 'already_present') {
    io.err(`${COMMAND_NAME} refuses to overwrite the existing plan ${outputPath}.`)
    return 2
  }
  if (emitted.status === 'failed') {
    io.err(`${COMMAND_NAME}: ${emitted.message}`)
    return 1
  }

  // The pause. Nothing else happens until a human comes back with this digest.
  io.out(`recovery rehearsal plan: ${outputPath}`)
  io.out(`plan sha256: ${plan.digest}`)
  io.out(
    'STOP. A human must read this plan and record an authorization carrying exactly this ' +
      'digest, then re-invoke with --apply --authorization=<authorization.json>.',
  )
  return 0
}

function readInputsDirectory(path: string): readonly RecoveryRehearsalDependencyFile[] {
  return readdirSync(path)
    .map((name) => join(path, name))
    .filter((file) => statSync(file).isFile())
    .map((file) => {
      const content = readFileSync(file, 'utf8')
      return { sha256: releaseEvidenceSha256(content), content }
    })
}

/** Either a usable stage result, or the exit code the CLI must return instead. */
type Stage<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: number }>

const APPLY_REQUIRED_FLAGS = [
  '--plan-file',
  '--authorization',
  '--observations',
  '--platform-receipt',
  '--inputs-dir',
  '--operator',
  '--reason',
  '--output',
] as const

/**
 * Argv refusals first: an audited action that is
 * missing its operator or reason must cost nothing.
 */
function refusedApplyArgument(
  args: readonly string[],
  io: RehearseRecoveryIo,
): number | undefined {
  const missing = APPLY_REQUIRED_FLAGS.filter(
    (flag) => flagValue(args, flag) === undefined,
  )
  if (missing.length === 0) return undefined
  io.err(
    `${COMMAND_NAME} --apply is an audited operator action and needs ${missing.join(', ')}.`,
  )
  io.err(
    'The platform point-in-time restore is performed by the operator; this command only ' +
      'consumes the platform receipt and the retained read-backs.',
  )
  io.err(usage())
  return 2
}

type ApplyDocuments = Readonly<{
  planDocument: string
  authorizationDocument: string
  observationsDocument: string
  platformReceipt: string
  inputs: readonly RecoveryRehearsalDependencyFile[]
}>

function readApplyDocuments(
  args: readonly string[],
  io: RehearseRecoveryIo,
): Stage<ApplyDocuments> {
  try {
    return {
      ok: true,
      value: {
        planDocument: readFileSync(resolve(flagValue(args, '--plan-file') ?? ''), 'utf8'),
        authorizationDocument: readFileSync(
          resolve(flagValue(args, '--authorization') ?? ''),
          'utf8',
        ),
        observationsDocument: readFileSync(
          resolve(flagValue(args, '--observations') ?? ''),
          'utf8',
        ),
        platformReceipt: readFileSync(
          resolve(flagValue(args, '--platform-receipt') ?? ''),
          'utf8',
        ),
        inputs: readInputsDirectory(resolve(flagValue(args, '--inputs-dir') ?? '')),
      },
    }
  } catch (error) {
    io.err(`${COMMAND_NAME}: ${error instanceof Error ? error.message : String(error)}`)
    return { ok: false, code: 2 }
  }
}

function parseApplyAuthorization(
  args: readonly string[],
  authorizationDocument: string,
  io: RehearseRecoveryIo,
): Stage<z.infer<typeof authorizationSchema>> {
  const authorization = authorizationSchema.safeParse(JSON.parse(authorizationDocument))
  if (!authorization.success) {
    io.err(`${COMMAND_NAME}: authorization artifact is invalid:`)
    for (const issue of authorization.error.issues) {
      io.err(`  authorization.${issue.path.join('.')}: ${issue.message}`)
    }
    return { ok: false, code: 2 }
  }
  if (authorization.data.operator !== flagValue(args, '--operator')) {
    io.err(
      `${COMMAND_NAME}: --operator=${flagValue(args, '--operator')} did not sign this ` +
        `authorization (${authorization.data.operator}).`,
    )
    return { ok: false, code: 2 }
  }
  return { ok: true, value: authorization.data }
}

/**
 * Walk the machine. `execute` is where the authorization is enforced; a
 * mismatched digest stops the run before any read-back is trusted.
 */
function refusedPhaseWalk(
  planSha256: string,
  authorization: z.infer<typeof authorizationSchema>,
  io: RehearseRecoveryIo,
): number | undefined {
  let phase: RecoveryRehearsalPhase = 'plan'
  for (const next of RECOVERY_REHEARSAL_PHASES.slice(1)) {
    const step = recoveryRehearsalTransition({
      from: phase,
      to: next,
      planSha256,
      authorization,
    })
    if (!step.ok) {
      io.err(`${COMMAND_NAME}: refusing to advance to ${next}:`)
      for (const error of step.errors) io.err(`  ${error}`)
      return 1
    }
    phase = step.phase
  }
  return undefined
}

type AssembledRehearsal = Extract<
  ReturnType<typeof assembleRecoveryRehearsalEvidence>,
  { ok: true }
>

function emitRehearsalArtifacts(
  assembled: AssembledRehearsal,
  outputPath: string,
  dependencyDir: string,
  io: RehearseRecoveryIo,
): number {
  for (const dependency of assembled.dependencies) {
    const path = resolve(dependencyDir, `${dependency.sha256}.dependency`)
    // The filename is the digest, so a sibling that is already there holds
    // these exact bytes. Retaining it twice is not a conflict.
    const retained = writeContentAddressed(path, dependency.content)
    if (retained.status === 'failed') {
      io.err(`${COMMAND_NAME}: ${retained.message}`)
      return 1
    }
  }

  // The exclusive create IS the refusal — there is no separate existence check
  // to race against. An artifact that is already there ends the run.
  const emitted = writeOnce(
    outputPath,
    canonicalRecoveryRehearsalEvidence(assembled.evidence),
  )
  if (emitted.status === 'already_present') {
    io.err(`${COMMAND_NAME} refuses to overwrite the existing artifact ${outputPath}.`)
    return 2
  }
  if (emitted.status === 'failed') {
    io.err(`${COMMAND_NAME}: ${emitted.message}`)
    return 1
  }

  io.out(`recovery rehearsal ${assembled.evidence.outcome}: ${outputPath}`)
  io.out(`retained ${assembled.dependencies.length} dependency files in ${dependencyDir}`)
  return assembled.evidence.outcome === 'passed' ? 0 : 1
}

function runApplyMode(args: readonly string[], io: RehearseRecoveryIo): number {
  const refusal = refusedApplyArgument(args, io)
  if (refusal !== undefined) return refusal

  const outputPath = resolve(flagValue(args, '--output') ?? '')

  const documents = readApplyDocuments(args, io)
  if (!documents.ok) return documents.code
  const { planDocument, authorizationDocument, observationsDocument, platformReceipt } =
    documents.value

  const parsed = parseApplyAuthorization(args, authorizationDocument, io)
  if (!parsed.ok) return parsed.code
  const authorization = parsed.value

  const planSha256 = releaseEvidenceSha256(planDocument)
  const platformReceiptSha256 = releaseEvidenceSha256(platformReceipt)

  const refusedPhase = refusedPhaseWalk(planSha256, authorization, io)
  if (refusedPhase !== undefined) return refusedPhase

  let observations: unknown
  try {
    observations = JSON.parse(observationsDocument)
  } catch (error) {
    io.err(`${COMMAND_NAME}: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }

  const assembled = assembleRecoveryRehearsalEvidence({
    observations,
    authorization,
    planSha256,
    dependencyFiles: [
      ...documents.value.inputs,
      { sha256: platformReceiptSha256, content: platformReceipt },
      { sha256: planSha256, content: planDocument },
      {
        sha256: releaseEvidenceSha256(authorizationDocument),
        content: authorizationDocument,
      },
    ],
  })
  if (!assembled.ok) {
    io.err(`${COMMAND_NAME}: refusing to emit recovery rehearsal evidence:`)
    for (const error of assembled.errors) io.err(`  ${error}`)
    return 1
  }

  if (
    assembled.evidence.recoveryPath === 'incompatible_data_restore' &&
    assembled.evidence.restore.platformReceipt.sha256 !== platformReceiptSha256
  ) {
    io.err(
      `${COMMAND_NAME}: --platform-receipt hashes to ${platformReceiptSha256}, but the ` +
        `read-back names ${assembled.evidence.restore.platformReceipt.sha256}. The receipt ` +
        'must be the exact platform-issued artifact for this restore.',
    )
    return 1
  }

  return emitRehearsalArtifacts(
    assembled,
    outputPath,
    resolve(flagValue(args, '--dependency-dir') ?? dirname(outputPath)),
    io,
  )
}

export async function runRehearseRecoveryCli(
  args: readonly string[],
  deps: RehearseRecoveryDeps = {},
): Promise<number> {
  const io = deps.io ?? consoleIo
  const now = deps.now ?? (() => new Date().toISOString())
  const isPlan = args.includes('--plan')
  const isApply = args.includes('--apply')

  if (isPlan === isApply) {
    io.err(`${COMMAND_NAME} needs exactly one of --plan or --apply.`)
    io.err(usage())
    return 2
  }
  return isPlan ? runPlanMode(args, io, now) : runApplyMode(args, io)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await runRehearseRecoveryCli(process.argv.slice(2))
}
