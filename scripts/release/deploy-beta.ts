// release:beta — deploy ONE revision to every google-closed-beta service, wait
// for every deployment to settle, then prove it (ADR 0051, runbook §3).
//
// Why this exists: the procedure used to be ~16 hand-typed commands across six
// services with two different variable contracts. Typing `RELEASE_SHA` alone —
// what the earlier runbook said — produced a FAILED web deploy and a crashed
// worker on 2026-08-21. The contract is now code.
//
// The two service classes are a property of the SERVICES, not of this script:
//
//   * IDENTITY_SERVICES bake IMAGE_SOURCE_REVISION at build time from the
//     SOURCE_REVISION build argument, and `assertReleaseIdentity` refuses a
//     production boot when it differs from the RELEASE_SHA service variable.
//     Both names carry the same fact, so both must be set.
//   * AI_SERVICES validate their environment against an EXACT allowlist
//     (services/ai-egress-gateway/environment.ts,
//     services/ai-execution-admission/environment.ts) and refuse to start when
//     an unknown variable is present. Their images bake no
//     IMAGE_SOURCE_REVISION, so the identity guard cannot fire there and
//     SOURCE_REVISION MUST NOT be set.
//
// Deploy order is load-bearing: `web` runs the migrations in its
// preDeployCommand (railway.json), so it goes first and alone.
//
// THREE things this script refuses to lie about:
//
//   1. Settlement. `railway up --detach` returns before the build exists, and
//      the service variables are written BEFORE it — so a variable read-back
//      taken right after the upload is tautological. Every deploy is therefore
//      tracked by the deployment id parsed out of `railway up`'s build-log URL
//      and polled to a terminal state; anything but SUCCESS fails the release.
//   2. Provenance. `railway up` uploads the WORKING TREE, not a CI-built
//      artifact. --apply refuses a dirty tree AND refuses a HEAD that is not an
//      ancestor of origin/main, so a release can only ever be reviewed,
//      CI-exercised, merged code (--force overrides, loudly).
//   3. Staleness. --verify-only asserts against an EXPECTED sha (origin/main by
//      default), not merely that the six services agree with each other: a beta
//      uniformly stuck on an old revision is not a verified beta.
//
// --apply is an audited operator action: it runs through the operator-command
// harness (scripts/ops/operator-command.ts), so it needs --operator <id> (in
// OPS_OPERATOR_IDENTITIES), --reason <text>, and a reachable DATABASE_URL to
// land the policy_decision_audit row — the same contract every ops:* mutation
// follows. --skip-audit exists for the incident case where the database is
// unreachable; it prints an UNAUDITED banner and is documented as such.
//
// Usage:
//   pnpm release:beta                                  # plan only, no railway call
//   pnpm release:beta --apply --operator <id> --reason "<text>"
//   pnpm release:beta --verify-only                    # prove against origin/main
//   pnpm release:beta --verify-only --expect <sha|any>
//   flags: --app-url <url> --deploy-timeout <seconds> --force --skip-audit
//
// Verification, always run after a settled --apply and by --verify-only:
//   1. RELEASE_SHA read back from all six services (blocking),
//   2. GET /api/health with every readiness boolean true (blocking when a URL
//      is known: --app-url or BETA_APP_URL),
//   3. every ai_execution_control_heads row enabled/accepting (blocking when
//      DATABASE_URL is set; skipped, printed, otherwise).

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const COMMAND_NAME = 'release:beta'
const ENVIRONMENT = 'google-closed-beta'

/** Release identity is DOUBLE-named here: RELEASE_SHA and SOURCE_REVISION. */
const IDENTITY_SERVICES = [
  'web',
  'worker',
  'google-egress-gateway',
  'google-execution-admission',
] as const

/** Exact-allowlist environments: RELEASE_SHA only, or the service refuses boot. */
const AI_SERVICES = ['ai-egress-gateway', 'ai-execution-admission'] as const

const ALL_SERVICES = [...IDENTITY_SERVICES, ...AI_SERVICES] as const

const HEADS_QUERY =
  'select scope_key, execution_state, admission_state from ai_execution_control_heads order by 1'

/** Railway deployment states that will never change again. */
const TERMINAL_STATUSES = new Set(['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED', 'SKIPPED'])

const DEFAULT_DEPLOY_TIMEOUT_SECONDS = 900
const POLL_INTERVAL_MS = 10_000

/** Flags this script owns; stripped before argv reaches the operator harness. */
const OWN_VALUE_FLAGS = ['--app-url', '--expect', '--deploy-timeout'] as const
const OWN_BOOLEAN_FLAGS = ['--verify-only', '--force', '--skip-audit'] as const

type ServicePlan = { readonly service: string; readonly variables: readonly string[] }

type Deployment = { readonly service: string; readonly deploymentId: string | undefined }

type HeadRow = {
  readonly scope_key: string
  readonly execution_state: string
  readonly admission_state: string
}

type Options = {
  readonly apply: boolean
  readonly verifyOnly: boolean
  readonly force: boolean
  readonly skipAudit: boolean
  readonly appUrl: string | undefined
  readonly expect: string | undefined
  readonly deployTimeoutMs: number
}

function deployPlan(sha: string): readonly ServicePlan[] {
  return [
    ...IDENTITY_SERVICES.map((service) => ({
      service,
      variables: [`RELEASE_SHA=${sha}`, `SOURCE_REVISION=${sha}`],
    })),
    ...AI_SERVICES.map((service) => ({
      service,
      variables: [`RELEASE_SHA=${sha}`],
    })),
  ]
}

function out(line: string): void {
  process.stdout.write(`${line}\n`)
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  const next = index === -1 ? undefined : args[index + 1]
  return next?.startsWith('--') ? undefined : next
}

function parseOptions(args: readonly string[]): Options | string {
  const timeoutRaw = flagValue(args, '--deploy-timeout')
  const timeoutSeconds =
    timeoutRaw === undefined ? DEFAULT_DEPLOY_TIMEOUT_SECONDS : Number(timeoutRaw)
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    return `--deploy-timeout must be a positive number of seconds (got '${String(timeoutRaw)}')`
  }
  const options: Options = {
    apply: args.includes('--apply'),
    verifyOnly: args.includes('--verify-only'),
    force: args.includes('--force'),
    skipAudit: args.includes('--skip-audit'),
    appUrl: flagValue(args, '--app-url') ?? process.env.BETA_APP_URL,
    expect: flagValue(args, '--expect'),
    deployTimeoutMs: timeoutSeconds * 1000,
  }
  if (options.apply && options.verifyOnly) {
    return '--apply and --verify-only are mutually exclusive'
  }
  return options
}

/** argv with this script's own flags removed, so the harness sees only its own. */
function harnessArgv(args: readonly string[]): string[] {
  const kept: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string
    const valueFlag = OWN_VALUE_FLAGS.find(
      (flag) => token === flag || token.startsWith(`${flag}=`),
    )
    if (valueFlag) {
      if (token === valueFlag) index += 1 // skip the separated value too
      continue
    }
    if (OWN_BOOLEAN_FLAGS.includes(token as (typeof OWN_BOOLEAN_FLAGS)[number])) continue
    kept.push(token)
  }
  return kept
}

function git(args: readonly string[]): string {
  const result = spawnSync('git', [...args], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`,
    )
  }
  return result.stdout.trim()
}

function gitOk(args: readonly string[]): boolean {
  return spawnSync('git', [...args], { encoding: 'utf8' }).status === 0
}

/** Run a railway command; throw naming the command and its stderr on failure. */
function railway(args: readonly string[]): string {
  const printable = `railway ${args.join(' ')}`
  const result = spawnSync('railway', [...args], { encoding: 'utf8' })
  if (result.error) throw new Error(`${printable}: ${result.error.message}`)
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`${printable} exited ${String(result.status)}\n${detail}`)
  }
  return result.stdout ?? ''
}

/**
 * `railway variable set` (one assignment per call) and `railway variable list`
 * are the non-legacy forms in CLI 5.34; `railway variables --set` is accepted
 * but marked legacy in `--help`. --skip-deploys keeps the variable writes from
 * triggering their own deploys, so `railway up` is the single trigger.
 *
 * Returns the deployment id parsed from `railway up`'s build-log URL. Parsing
 * the id (rather than reading "the latest deployment" afterwards) is what makes
 * settlement polling exact: no assumption about list ordering, and no risk of
 * watching a neighbouring deploy.
 */
function deployService(plan: ServicePlan): Deployment {
  for (const assignment of plan.variables) {
    railway([
      'variable',
      'set',
      assignment,
      '--service',
      plan.service,
      '--environment',
      ENVIRONMENT,
      '--skip-deploys',
    ])
  }
  const stdout = railway([
    'up',
    '--service',
    plan.service,
    '--environment',
    ENVIRONMENT,
    '--detach',
  ])
  process.stdout.write(stdout.endsWith('\n') || stdout === '' ? stdout : `${stdout}\n`)
  const deploymentId = /[?&]id=([0-9a-fA-F-]{36})/.exec(stdout)?.[1]
  if (!deploymentId) {
    out(
      `   WARNING: could not parse a deployment id for ${plan.service}; settlement will be read from its latest deployment`,
    )
  }
  return { service: plan.service, deploymentId }
}

type DeploymentRow = { readonly id?: string; readonly status?: string }

function deploymentStatus(deployment: Deployment): string {
  const listed = railway([
    'deployment',
    'list',
    '--service',
    deployment.service,
    '--environment',
    ENVIRONMENT,
    '--json',
  ])
  let rows: readonly DeploymentRow[]
  try {
    rows = JSON.parse(listed) as readonly DeploymentRow[]
  } catch {
    throw new Error(`could not parse deployment list for ${deployment.service}`)
  }
  const row = deployment.deploymentId
    ? rows.find((entry) => entry.id === deployment.deploymentId)
    : rows[0]
  return row?.status ?? 'UNKNOWN'
}

/**
 * Block until every deployment reaches a terminal state. Returns the failures,
 * so one bad service is reported alongside the rest rather than hiding them.
 */
async function awaitSettlement(
  deployments: readonly Deployment[],
  timeoutMs: number,
): Promise<readonly string[]> {
  const deadline = Date.now() + timeoutMs
  const pending = new Map(deployments.map((d) => [d.service, d]))
  const failures: string[] = []
  out('')
  out('waiting for deployments to settle:')
  while (pending.size > 0) {
    for (const [service, deployment] of [...pending]) {
      const status = deploymentStatus(deployment)
      if (!TERMINAL_STATUSES.has(status)) continue
      pending.delete(service)
      out(`  ${service.padEnd(28)} ${status}`)
      if (status !== 'SUCCESS') {
        failures.push(
          `${service}: deployment ${deployment.deploymentId ?? '(latest)'} ended ${status}`,
        )
      }
    }
    if (pending.size === 0) break
    if (Date.now() > deadline) {
      for (const [service, deployment] of pending) {
        failures.push(
          `${service}: deployment ${deployment.deploymentId ?? '(latest)'} still ${deploymentStatus(deployment)} after ${String(Math.round(timeoutMs / 1000))}s`,
        )
      }
      break
    }
    await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS))
  }
  return failures
}

function readReleaseSha(service: string): string {
  const listed = railway([
    'variable',
    'list',
    '--service',
    service,
    '--environment',
    ENVIRONMENT,
    '--kv',
  ])
  const line = listed.split('\n').find((entry) => entry.startsWith('RELEASE_SHA='))
  return line ? line.slice('RELEASE_SHA='.length).trim() : ''
}

/** Read-back table. Returns the failures so every service is reported, not the first. */
function verifyReleaseIdentity(expected: string | undefined): readonly string[] {
  const observed = ALL_SERVICES.map((service) => ({
    service,
    sha: readReleaseSha(service),
  }))
  for (const row of observed) {
    out(`  ${row.service.padEnd(28)} ${row.sha || '(unset)'}`)
  }
  const failures: string[] = []
  if (expected === undefined) {
    // --expect any: the services must agree, but no revision is named.
    const distinct = [...new Set(observed.map((row) => row.sha))]
    if (distinct.length !== 1 || distinct[0] === '') {
      failures.push(`services are not on one revision: ${distinct.join(', ')}`)
    }
    return failures
  }
  for (const row of observed) {
    if (row.sha !== expected) {
      failures.push(`${row.service}: RELEASE_SHA=${row.sha || '(unset)'} != ${expected}`)
    }
  }
  return failures
}

async function verifyHealth(appUrl: string): Promise<readonly string[]> {
  const url = `${appUrl.replace(/\/$/, '')}/api/health`
  let body: Record<string, unknown>
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    body = (await response.json()) as Record<string, unknown>
    out(`  ${url} → ${String(response.status)} ${JSON.stringify(body)}`)
    if (!response.ok) return [`${url} returned ${String(response.status)}`]
  } catch (error) {
    return [`${url}: ${error instanceof Error ? error.message : String(error)}`]
  }
  const failures: string[] = []
  if (body.status !== 'ok') failures.push(`health status=${String(body.status)}`)
  for (const probe of ['db', 'redis', 'migrations', 'policy']) {
    if (body[probe] !== true) failures.push(`health ${probe}=${String(body[probe])}`)
  }
  return failures
}

async function verifyAiHeads(databaseUrl: string): Promise<readonly string[]> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
  try {
    const { rows } = await pool.query<HeadRow>(HEADS_QUERY)
    for (const row of rows) {
      out(`  ${row.scope_key.padEnd(28)} ${row.execution_state}/${row.admission_state}`)
    }
    if (rows.length === 0) return ['ai_execution_control_heads is empty']
    return rows
      .filter(
        (row) => row.execution_state !== 'enabled' || row.admission_state !== 'accepting',
      )
      .map(
        (row) =>
          `${row.scope_key}: ${row.execution_state}/${row.admission_state} (want enabled/accepting)`,
      )
  } catch (error) {
    return [`ai head check: ${error instanceof Error ? error.message : String(error)}`]
  } finally {
    await pool.end()
  }
}

async function verify(
  expected: string | undefined,
  appUrl: string | undefined,
): Promise<readonly string[]> {
  const failures: string[] = []

  out('')
  out(
    expected === undefined
      ? 'release identity (RELEASE_SHA read back from Railway; --expect any: agreement only):'
      : `release identity (RELEASE_SHA read back from Railway; expecting ${expected}):`,
  )
  failures.push(...verifyReleaseIdentity(expected))

  out('')
  if (appUrl) {
    out('health:')
    failures.push(...(await verifyHealth(appUrl)))
  } else {
    out('skipped: health check (no --app-url and BETA_APP_URL unset)')
  }

  out('')
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl) {
    out('ai_execution_control_heads:')
    failures.push(...(await verifyAiHeads(databaseUrl)))
  } else {
    out('skipped: ai head check (DATABASE_URL unset)')
  }

  return failures
}

/**
 * `settled` distinguishes what was actually proven: a deploy run polled every
 * deployment to SUCCESS, while --verify-only only inspected the running
 * environment. The summary line must not claim the stronger fact.
 */
function report(failures: readonly string[], settled: boolean): number {
  out('')
  if (failures.length === 0) {
    out(
      settled
        ? 'verified: every deployment SUCCESS, one revision across all six services, health green, AI heads accepting'
        : 'verified: one revision across all six services, health green, AI heads accepting (no deploy in this run)',
    )
    return 0
  }
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`)
  return 1
}

/**
 * What --verify-only must prove. Default: origin/main — the beta is supposed to
 * run merged code, so "the six agree with each other" is not enough. `--expect
 * any` opts down to agreement; `--expect <sha>` names a revision.
 */
function resolveExpectation(expect: string | undefined): string | undefined {
  if (expect === 'any') return undefined
  if (expect) {
    return gitOk(['rev-parse', '--verify', `${expect}^{commit}`])
      ? git(['rev-parse', `${expect}^{commit}`])
      : expect
  }
  if (gitOk(['rev-parse', '--verify', 'origin/main'])) {
    return git(['rev-parse', 'origin/main'])
  }
  out('note: origin/main does not resolve here — falling back to agreement only')
  return undefined
}

/** --apply provenance: HEAD must be clean AND already merged into origin/main. */
function provenanceFailures(force: boolean): readonly string[] {
  const failures: string[] = []
  const dirty = git(['status', '--porcelain'])
  if (dirty) {
    failures.push('the working tree is dirty, so HEAD does not describe what would ship:')
    for (const line of dirty.split('\n')) failures.push(`  ${line}`)
  }
  // `railway up` uploads this directory. Refuse anything that is not merged:
  // a green verification on unreviewed code is the failure mode being closed.
  spawnSync('git', ['fetch', '--quiet', 'origin', 'main'], { encoding: 'utf8' })
  if (!gitOk(['rev-parse', '--verify', 'origin/main'])) {
    failures.push('origin/main does not resolve — cannot prove HEAD is merged code')
  } else if (!gitOk(['merge-base', '--is-ancestor', 'HEAD', 'origin/main'])) {
    failures.push(
      `HEAD (${git(['rev-parse', '--short', 'HEAD'])}) is not an ancestor of origin/main — merge it first, or pass --force to ship unreviewed code`,
    )
  }
  if (force && failures.length > 0) {
    out('')
    out('WARNING: --force overriding provenance refusals:')
    for (const failure of failures) out(`  ${failure}`)
    return []
  }
  return failures
}

async function deployAndVerify(sha: string, options: Options): Promise<number> {
  const plan = deployPlan(sha)
  out(`APPLY — environment ${ENVIRONMENT}, revision ${sha}`)

  // Web owns the pre-deploy database migration. Let Railway finish that
  // deployment (including its /api/health/started activation check) before a
  // worker or gateway can start running code that depends on the new schema.
  const [web, ...remaining] = plan
  if (!web || web.service !== 'web') {
    throw new Error('release plan must start with web')
  }

  out('')
  out(`1/${String(plan.length)} ${web.service}: ${web.variables.join(' ')}`)
  const webSettlement = await awaitSettlement(
    [deployService(web)],
    options.deployTimeoutMs,
  )
  if (webSettlement.length > 0) {
    return report(webSettlement, false)
  }

  const deployments: Deployment[] = []
  for (const [index, entry] of remaining.entries()) {
    out('')
    out(
      `${String(index + 2)}/${String(plan.length)} ${entry.service}: ${entry.variables.join(' ')}`,
    )
    deployments.push(deployService(entry))
  }

  const settlement = await awaitSettlement(deployments, options.deployTimeoutMs)
  if (settlement.length > 0) {
    // No point asserting health against a rollout that did not happen.
    return report(settlement, false)
  }

  return report(await verify(sha, options.appUrl), true)
}

function printPlan(sha: string): number {
  const plan = deployPlan(sha)
  out(`DRY RUN — environment ${ENVIRONMENT}, revision ${sha}`)
  out('Re-run with --apply --operator <id> --reason "<text>" to execute.')
  out('No railway command has been invoked.')
  const dirty = git(['status', '--porcelain'])
  if (dirty) {
    out('')
    out('WARNING: the tree is dirty; --apply will refuse. Uncommitted paths:')
    for (const line of dirty.split('\n')) out(`  ${line}`)
  }
  if (
    gitOk(['rev-parse', '--verify', 'origin/main']) &&
    !gitOk(['merge-base', '--is-ancestor', 'HEAD', 'origin/main'])
  ) {
    out('')
    out('WARNING: HEAD is not an ancestor of origin/main; --apply will refuse.')
  }
  for (const [index, entry] of plan.entries()) {
    out('')
    out(`${String(index + 1)}. ${entry.service}`)
    for (const assignment of entry.variables) {
      out(
        `   railway variable set ${assignment} --service ${entry.service} --environment ${ENVIRONMENT} --skip-deploys`,
      )
    }
    out(`   railway up --service ${entry.service} --environment ${ENVIRONMENT} --detach`)
    out(`   railway deployment list --service ${entry.service} --json  → poll to SUCCESS`)
  }
  return 0
}

export async function runDeployBetaCli(args: readonly string[]): Promise<number> {
  const parsed = parseOptions(args)
  if (typeof parsed === 'string') {
    process.stderr.write(`${parsed}\n`)
    return 2
  }
  const options = parsed

  if (options.verifyOnly) {
    out(`verify-only — environment ${ENVIRONMENT}`)
    return report(await verify(resolveExpectation(options.expect), options.appUrl), false)
  }

  const sha = git(['rev-parse', 'HEAD'])

  if (!options.apply) return printPlan(sha)

  // Cheapest refusals first: argv, then the git facts, then the network.
  //
  // The operator requirements are validated HERE rather than by the harness
  // because the harness boots the policy runtime (full env schema +
  // DATABASE_URL) before it parses argv, so a forgotten --reason would surface
  // as an env error.
  const missing = options.skipAudit
    ? []
    : ['--operator', '--reason'].filter((flag) => !flagValue(args, flag))
  if (missing.length > 0) {
    process.stderr.write(
      `${COMMAND_NAME} --apply is an audited operator action and needs ${missing.join(' and ')}.\n` +
        `Usage: pnpm ${COMMAND_NAME} --apply --operator <id> --reason "<text>"\n` +
        'The operator must be listed in OPS_OPERATOR_IDENTITIES and DATABASE_URL must be reachable\n' +
        'so the decision lands in policy_decision_audit (--skip-audit for the incident case).\n',
    )
    return 2
  }

  const provenance = provenanceFailures(options.force)
  if (provenance.length > 0) {
    process.stderr.write('refusing to deploy:\n')
    for (const failure of provenance) process.stderr.write(`  ${failure}\n`)
    return 1
  }

  if (options.skipAudit) {
    out('')
    out('════ UNAUDITED DEPLOY (--skip-audit) ════')
    out('No named operator, no policy_decision_audit row. Incident use only —')
    out('record the deploy in the incident log by hand.')
    out('')
    return deployAndVerify(sha, options)
  }

  // Audited path: same contract as every ops:* mutation — named operator from
  // OPS_OPERATOR_IDENTITIES, --reason, and one audited ExecutionPolicy decision
  // per invocation. Imported lazily so the dry-run and --verify-only paths keep
  // working without the full app env (the harness boots the policy runtime).
  const { runOperatorCommand } = await import('../ops/operator-command')
  const result = await runOperatorCommand(
    {
      name: COMMAND_NAME,
      scope: 'global',
      mutation: true,
      usage: `pnpm ${COMMAND_NAME} --apply --operator <id> --reason "<text>" [--app-url <url>] [--deploy-timeout <seconds>] [--force] [--skip-audit]`,
    },
    async () => deployAndVerify(sha, options),
    harnessArgv(args),
  )
  return result.exitCode
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await runDeployBetaCli(process.argv.slice(2)).catch(
    (error: unknown) => {
      process.stderr.write(
        `${COMMAND_NAME} failed: ${error instanceof Error ? error.message : String(error)}\n`,
      )
      return 1
    },
  )
}
