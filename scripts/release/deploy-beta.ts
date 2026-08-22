// release:beta — deploy ONE revision to every google-closed-beta service, then
// prove the deployment (ADR 0051, runbook §3).
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
// Dry-run by default, like every ops:* command. `--apply` deploys; the dirty
// tree check blocks only `--apply`, so the plan stays previewable from a
// work-in-progress tree while a deploy can only ever name a committed revision.
//
// Usage:
//   pnpm release:beta                      # print the ordered plan, touch nothing
//   pnpm release:beta --apply              # deploy, then verify
//   pnpm release:beta --verify-only        # re-prove the running deployment
//   pnpm release:beta --apply --app-url https://beta.example.com
//
// Verification is the deploy's proof and always runs after --apply:
//   1. read RELEASE_SHA back from all six services (blocking),
//   2. GET /api/health and require every readiness boolean (blocking when a
//      URL is known),
//   3. assert every ai_execution_control_heads row is enabled/accepting
//      (blocking when DATABASE_URL is set; skipped, printed, otherwise).

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

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

type ServicePlan = { readonly service: string; readonly variables: readonly string[] }

type HeadRow = {
  readonly scope_key: string
  readonly execution_state: string
  readonly admission_state: string
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

function git(args: readonly string[]): string {
  const result = spawnSync('git', [...args], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`,
    )
  }
  return result.stdout.trim()
}

/** Run a railway command; throw naming the command and its stderr on failure. */
function railway(args: readonly string[], inherit = false): string {
  const printable = `railway ${args.join(' ')}`
  const result = spawnSync('railway', [...args], {
    encoding: 'utf8',
    stdio: inherit ? ['ignore', 'inherit', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  })
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
 */
function deployService(plan: ServicePlan): void {
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
  railway(
    ['up', '--service', plan.service, '--environment', ENVIRONMENT, '--detach'],
    true,
  )
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
  const distinct = [...new Set(observed.map((row) => row.sha))]
  const failures: string[] = []
  if (expected === undefined) {
    // --verify-only can run from any checkout, so uniformity is the assertion;
    // whether it matches this working copy is reported, not enforced.
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
  out('release identity (RELEASE_SHA read back from Railway):')
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

export async function runDeployBetaCli(args: readonly string[]): Promise<number> {
  const apply = args.includes('--apply')
  const verifyOnly = args.includes('--verify-only')
  if (apply && verifyOnly) {
    process.stderr.write('--apply and --verify-only are mutually exclusive\n')
    return 2
  }
  const appUrl = flagValue(args, '--app-url') ?? process.env.BETA_APP_URL

  if (verifyOnly) {
    out(`verify-only — environment ${ENVIRONMENT}`)
    const failures = await verify(undefined, appUrl)
    return report(failures)
  }

  const sha = git(['rev-parse', 'HEAD'])
  const dirty = git(['status', '--porcelain'])
  const plan = deployPlan(sha)

  if (!apply) {
    out(`DRY RUN — environment ${ENVIRONMENT}, revision ${sha}`)
    out('Re-run with --apply to execute. No railway command has been invoked.')
    if (dirty) {
      out('')
      out('WARNING: the tree is dirty; --apply will refuse. Uncommitted paths:')
      for (const line of dirty.split('\n')) out(`  ${line}`)
    }
    for (const [index, entry] of plan.entries()) {
      out('')
      out(`${String(index + 1)}. ${entry.service}`)
      for (const assignment of entry.variables) {
        out(
          `   railway variable set ${assignment} --service ${entry.service} --environment ${ENVIRONMENT} --skip-deploys`,
        )
      }
      out(
        `   railway up --service ${entry.service} --environment ${ENVIRONMENT} --detach`,
      )
    }
    return 0
  }

  if (dirty) {
    process.stderr.write(
      'refusing to deploy: the working tree is dirty, so HEAD does not describe what would ship.\n',
    )
    for (const line of dirty.split('\n')) process.stderr.write(`  ${line}\n`)
    return 1
  }

  out(`APPLY — environment ${ENVIRONMENT}, revision ${sha}`)
  for (const [index, entry] of plan.entries()) {
    out('')
    out(
      `${String(index + 1)}/${String(plan.length)} ${entry.service}: ${entry.variables.join(' ')}`,
    )
    deployService(entry)
  }

  return report(await verify(sha, appUrl))
}

function report(failures: readonly string[]): number {
  out('')
  if (failures.length === 0) {
    out(
      'verified: one revision across all six services, health green, AI heads accepting',
    )
    return 0
  }
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`)
  return 1
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await runDeployBetaCli(process.argv.slice(2)).catch(
    (error: unknown) => {
      process.stderr.write(
        `release:beta failed: ${error instanceof Error ? error.message : String(error)}\n`,
      )
      return 1
    },
  )
}
