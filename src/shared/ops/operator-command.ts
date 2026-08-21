// Operator command harness (BQC-7.5) — the shell every scripts/ops/* command
// runs through. One invocation contract for all operator commands:
//
//   --operator <id>   REQUIRED. Named operator identity; must be registered
//                     in OPS_OPERATOR_IDENTITIES (the ExecutionPolicy operator
//                     branch denies operator_not_registered otherwise).
//   --org <id>        Required for scope 'org' and 'property' commands.
//   --property <id>   Required for scope 'property' commands.
//   --reason <text>   Required WITH --apply on mutation commands (min length
//                     is enforced by the underlying op where applicable).
//   --ticket <ref>    Required WITH --apply when the spec sets requiresTicket.
//   --apply           Execute a mutation. DEFAULT IS DRY-RUN: mutations
//                     without --apply report what would change and write
//                     nothing.
//   --dry-run         Explicit report mode (conflicts with --apply).
//   --yes <name>      Typed confirmation — required WITH --apply when the
//                     spec is destructive (must equal the command name).
//   --batch-size <n>  Bounded work, when the spec enables it (clamped to the
//                     spec's max).
//
// Every parsed invocation — reads included — is evaluated through the
// installed ExecutionPolicy with the named operator principal, the command
// scope, and a per-invocation correlation id. The policy writes the
// content-free decision audit row for BOTH allow and deny (actorType
// 'operator', executionKind 'operator', action 'system:ops' — the catalogue
// assignment); allow rows carry the operator reason (or 'read' / 'dry-run'),
// deny rows the typed deny reason. Denies exit 1 with the typed reason.
//
// Capability gates: a command spec MAY declare the capability its work
// depends on (e.g. inbox.use for a projection rebuild) — the policy then
// enforces kill-switch/blocked/suspension state before the command runs.
// Containment and diagnostic commands (queue pause, suspension, inspect)
// deliberately declare NO capability so they keep working while the
// capability they contain is killed or the org is suspended.
//
// This module is pure orchestration: the policy evaluation is injected
// (OperatorRuntime), so unit tests never touch a database. The scripts/ops
// shim (scripts/ops/operator-command.ts) binds the real runtime (policy
// store init + the installed ExecutionPolicy singleton).

import { randomUUID } from 'node:crypto'
import type { Capability } from '#/shared/auth/beta-capabilities'
import type { DecisionRequest, ExecutionDecision } from '#/shared/auth/execution-policy'

/** The catalogue action every operator command evaluates (entry-point catalogue). */
export const OPERATOR_ACTION = 'system:ops'

export type OperatorScope = 'global' | 'org' | 'property'

export type OperatorCommandSpec = Readonly<{
  /** Command name as invoked (e.g. 'ops:purge') — the typed --yes target. */
  name: string
  /** The scope the command acts on. */
  scope: OperatorScope
  /** Capability the work depends on; omit for containment/diagnostic commands. */
  capability?: Capability
  /** Mutations are dry-run by default; --apply executes and requires --reason. */
  mutation?: boolean
  /** Destructive mutations additionally require typed confirmation --yes <name>. */
  destructive?: boolean
  /** Requires --ticket <ref> with --apply (policy-admin operations). */
  requiresTicket?: boolean
  /** Enables --batch-size with a default and an upper bound. */
  batchSize?: Readonly<{ default: number; max: number }>
  /** Extra boolean flags the command accepts (e.g. 'all-ambiguous'). */
  extraFlags?: ReadonlyArray<string>
  /** One-line usage printed on argument errors. */
  usage: string
}>

export type OperatorArgs = Readonly<{
  operator: string
  reason?: string
  ticket?: string
  /** Last --org wins; `organizations` collects every --org in order. */
  organizationId?: string
  organizations: ReadonlyArray<string>
  propertyId?: string
  apply: boolean
  dryRunFlag: boolean
  yes?: string
  batchSize?: number
  flags: ReadonlySet<string>
  positionals: ReadonlyArray<string>
}>

export type OperatorContext = Readonly<{
  operatorId: string
  correlationId: string
  organizationId?: string
  propertyId?: string
  /** True for a mutation invoked without --apply — report only, no writes. */
  dryRun: boolean
  reason?: string
  ticket?: string
  batchSize?: number
  decision: ExecutionDecision
}>

export type OperatorAction = (
  ctx: OperatorContext,
  args: OperatorArgs,
  io: OperatorIO,
) => Promise<number | void>

export type OperatorRuntime = Readonly<{
  decide: (request: DecisionRequest) => Promise<ExecutionDecision>
  now?: () => Date
  newCorrelationId?: () => string
}>

export type OperatorIO = Readonly<{
  out: (line: string) => void
  err: (line: string) => void
}>

export type OperatorCommandResult = Readonly<{
  exitCode: number
  correlationId?: string
  decision?: ExecutionDecision
}>

const defaultIO: OperatorIO = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
}

// ── Argument parsing ─────────────────────────────────────────────────

const VALUE_FLAGS = new Set([
  '--operator',
  '--reason',
  '--ticket',
  '--org',
  '--property',
  '--yes',
  '--batch-size',
])

/**
 * Positional arguments with every harness flag (and its value) stripped.
 * Scripts use this to read their subcommand/ids before building the spec.
 */
export function positionalArgs(argv: ReadonlyArray<string>): ReadonlyArray<string> {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string
    if (VALUE_FLAGS.has(token)) {
      i++
      continue
    }
    if (token.startsWith('--')) continue
    out.push(token)
  }
  return out
}

export type ParseResult =
  Readonly<{ ok: true; args: OperatorArgs }> | Readonly<{ ok: false; error: string }>

type ParsedToken =
  | Readonly<{ kind: 'boolean-flag'; name: string }>
  | Readonly<{ kind: 'value-flag'; name: string; value: string }>
  | Readonly<{ kind: 'positional'; value: string }>

/** Classify one argv token; `consumed` counts the argv slots it spans. */
function classifyToken(
  argv: ReadonlyArray<string>,
  index: number,
  booleanFlags: ReadonlySet<string>,
): Readonly<{ token: ParsedToken; consumed: number } | { error: string }> {
  const raw = argv[index] as string
  if (booleanFlags.has(raw)) {
    return { token: { kind: 'boolean-flag', name: raw.slice(2) }, consumed: 1 }
  }
  if (VALUE_FLAGS.has(raw)) {
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      return { error: `${raw} requires a value` }
    }
    return { token: { kind: 'value-flag', name: raw.slice(2), value }, consumed: 2 }
  }
  if (raw.startsWith('--')) {
    return { error: `unknown flag '${raw}'` }
  }
  return { token: { kind: 'positional', value: raw }, consumed: 1 }
}

function parseBatchSize(
  values: ReadonlyMap<string, string>,
): Readonly<{ ok: true; batchSize?: number }> | Readonly<{ ok: false; error: string }> {
  const raw = values.get('batch-size')
  if (raw === undefined) return { ok: true, batchSize: undefined }
  const batchSize = Number(raw)
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    return { ok: false, error: `--batch-size must be a positive integer (got '${raw}')` }
  }
  return { ok: true, batchSize }
}

export function parseOperatorArgs(
  argv: ReadonlyArray<string>,
  spec: OperatorCommandSpec,
): ParseResult {
  const booleanFlags = new Set([
    '--apply',
    '--dry-run',
    ...(spec.extraFlags ?? []).map((f) => `--${f}`),
  ])
  const values = new Map<string, string>()
  const organizations: string[] = []
  const flags = new Set<string>()
  const positionals: string[] = []

  for (let i = 0; i < argv.length;) {
    const classified = classifyToken(argv, i, booleanFlags)
    if ('error' in classified) return { ok: false, error: classified.error }
    const { token, consumed } = classified
    if (token.kind === 'boolean-flag') flags.add(token.name)
    else if (token.kind === 'positional') positionals.push(token.value)
    else if (token.name === 'org') organizations.push(token.value)
    else values.set(token.name, token.value)
    i += consumed
  }

  const batch = parseBatchSize(values)
  if (!batch.ok) return { ok: false, error: batch.error }

  return {
    ok: true,
    args: {
      operator: values.get('operator') ?? '',
      reason: values.get('reason'),
      ticket: values.get('ticket'),
      organizationId: organizations[organizations.length - 1],
      organizations,
      propertyId: values.get('property'),
      apply: flags.has('apply'),
      dryRunFlag: flags.has('dry-run'),
      yes: values.get('yes'),
      batchSize: batch.batchSize,
      flags,
      positionals,
    },
  }
}

function validateIdentityAndScope(
  spec: OperatorCommandSpec,
  args: OperatorArgs,
): string | null {
  if (!args.operator) {
    return '--operator <id> is required (named operator; must be registered in OPS_OPERATOR_IDENTITIES)'
  }
  if (spec.scope !== 'global' && !args.organizationId) {
    return '--org <id> is required for this command'
  }
  if (spec.scope === 'property' && !args.propertyId) {
    return '--property <id> is required for this command'
  }
  return null
}

function validateMode(spec: OperatorCommandSpec, args: OperatorArgs): string | null {
  if (args.apply && args.dryRunFlag) {
    return '--apply and --dry-run conflict — pick one'
  }
  if (!spec.mutation && args.apply) {
    return '--apply is only valid for mutation commands (this command is a read)'
  }
  return null
}

/** Reason/ticket/typed-confirmation gate the EXECUTION (--apply), never the report. */
function validateMutationRequirements(
  spec: OperatorCommandSpec,
  args: OperatorArgs,
): string | null {
  if (!args.apply) return null
  if (spec.mutation && !args.reason) {
    return '--reason <text> is required with --apply (audited with the command)'
  }
  if (spec.requiresTicket && !args.ticket) {
    return '--ticket <ref> is required with --apply (audited with the command)'
  }
  if (spec.destructive && args.yes !== spec.name) {
    return `destructive command — confirm with --yes ${spec.name}`
  }
  return null
}

function validateBatchSize(spec: OperatorCommandSpec, args: OperatorArgs): string | null {
  if (args.batchSize === undefined) return null
  if (!spec.batchSize) return '--batch-size is not supported by this command'
  if (args.batchSize > spec.batchSize.max) {
    return `--batch-size must be <= ${spec.batchSize.max} (bounded work)`
  }
  return null
}

/** Spec validation — returns the usage error, or null when the args are runnable. */
export function validateOperatorArgs(
  spec: OperatorCommandSpec,
  args: OperatorArgs,
): string | null {
  return (
    validateIdentityAndScope(spec, args) ??
    validateMode(spec, args) ??
    validateMutationRequirements(spec, args) ??
    validateBatchSize(spec, args)
  )
}

// ── The runner ────────────────────────────────────────────────────────

function usageError(
  spec: OperatorCommandSpec,
  io: OperatorIO,
  error: string,
): OperatorCommandResult {
  io.err(`${spec.name}: ${error}`)
  io.err(`usage: ${spec.usage}`)
  return { exitCode: 1 }
}

function decisionRequestFor(
  spec: OperatorCommandSpec,
  args: OperatorArgs,
  correlationId: string,
  now: Date,
): DecisionRequest {
  return {
    principal: { kind: 'operator', id: args.operator },
    action: OPERATOR_ACTION,
    capability: spec.capability,
    organizationId: args.organizationId,
    propertyId: args.propertyId,
    executionKind: 'operator',
    // Reads audit as 'read', dry-run reports as 'dry-run', applied mutations
    // carry the operator's reason (recorded on the allow row, sliced).
    reason: args.reason ?? (spec.mutation ? 'dry-run' : 'read'),
    now,
    correlationId,
  }
}

function contextFor(
  spec: OperatorCommandSpec,
  args: OperatorArgs,
  correlationId: string,
  dryRun: boolean,
  decision: ExecutionDecision,
): OperatorContext {
  return {
    operatorId: args.operator,
    correlationId,
    organizationId: args.organizationId,
    propertyId: args.propertyId,
    dryRun,
    reason: args.reason,
    ticket: args.ticket,
    batchSize: args.batchSize ?? spec.batchSize?.default,
    decision,
  }
}

function headerLine(
  spec: OperatorCommandSpec,
  args: OperatorArgs,
  correlationId: string,
  dryRun: boolean,
  decision: ExecutionDecision,
): string {
  const mode = spec.mutation ? (dryRun ? ' mode=dry-run' : ' mode=apply') : ''
  return (
    `${spec.name} — operator=${args.operator} correlation=${correlationId} ` +
    `decision=${decision.allowed ? 'allow' : `deny:${decision.reason}`}${mode}`
  )
}

/**
 * Parse → validate → evaluate the ExecutionPolicy (audited, allow AND deny)
 * → run the action on allow. Returns the process exit code; the caller
 * (scripts/ops shim) owns process.exit.
 */
export async function runOperatorCommand(
  spec: OperatorCommandSpec,
  action: OperatorAction,
  runtime: OperatorRuntime,
  argv: ReadonlyArray<string>,
  io: OperatorIO = defaultIO,
): Promise<OperatorCommandResult> {
  const parsed = parseOperatorArgs(argv, spec)
  if (!parsed.ok) return usageError(spec, io, parsed.error)
  const invalid = validateOperatorArgs(spec, parsed.args)
  if (invalid) return usageError(spec, io, invalid)
  const args = parsed.args

  const correlationId = runtime.newCorrelationId?.() ?? randomUUID()
  const dryRun = spec.mutation ? !args.apply : false
  const decision = await runtime.decide(
    decisionRequestFor(spec, args, correlationId, runtime.now?.() ?? new Date()),
  )
  io.out(headerLine(spec, args, correlationId, dryRun, decision))

  if (!decision.allowed) {
    return { exitCode: 1, correlationId, decision }
  }

  try {
    const code = await action(
      contextFor(spec, args, correlationId, dryRun, decision),
      args,
      io,
    )
    return { exitCode: code ?? 0, correlationId, decision }
  } catch (err) {
    io.err(`${spec.name} failed: ${err instanceof Error ? err.message : String(err)}`)
    return { exitCode: 1, correlationId, decision }
  }
}
