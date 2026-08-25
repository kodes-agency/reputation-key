// release:beta — promote ONE signed, digest-pinned CI release manifest into one
// Railway Data Cell, wait for every deployment to settle, then prove it.
//
// Why this exists: the procedure used to be many hand-typed commands across
// services with two different variable contracts. Typing `RELEASE_SHA` alone —
// what the earlier runbook said — produced a FAILED web deploy and a crashed
// worker on 2026-08-21. The contract is now code.
//
// CI bakes IMAGE_SOURCE_REVISION / the OCI source-revision label. Promotion
// never rebuilds and never writes SOURCE_REVISION: Railway receives the exact
// registry digest recorded in the manifest plus RELEASE_SHA as runtime truth.
//
// Deploy order is load-bearing: provider Redis is brought up first; `web`
// then runs the migrations in its IaC-owned preDeployCommand before workers
// or effect services receive the candidate.
//
// THREE things this script refuses to lie about:
//
//   1. Settlement. Source connection returns before a deployment settles.
//      Every promotion is tracked by deployment id and polled to a terminal
//      state; anything but SUCCESS fails the release.
//   2. Provenance. The canonical manifest and Sigstore bundle are verified
//      against the producing main-branch GitHub Actions identity. Every image
//      is digest-pinned and names that same merged source revision.
//   3. Staleness. --verify-only asserts the exact signed manifest SHA, source
//      revision, and every active Railway image digest. Uniformly old or mixed
//      services cannot pass.
//
// --apply is an audited operator action: it runs through the operator-command
// harness (scripts/ops/operator-command.ts), so it needs --operator <id> (in
// OPS_OPERATOR_IDENTITIES), --reason <text>, and a reachable DATABASE_URL to
// land the policy_decision_audit row — the same contract every ops:* mutation
// follows. There is deliberately no unaudited bypass: an emergency promotion
// still needs a named operator, reason, and durable policy-decision evidence.
//
// Usage:
//   pnpm release:beta --manifest <manifest.json> --signature-bundle <bundle.json>
//     --manifest-sha256 <digest> --cell <us|europe|global>
//   add --apply --operator <id> --reason "<text>" to execute
//   add --verify-only to prove an already-promoted cell
//   flags: --app-url <url> --deploy-timeout <seconds>
//
// Verification, always run after a settled --apply and by --verify-only:
//   1. RELEASE_SHA + RELEASE_MANIFEST_SHA256 from every service (blocking),
//   2. active Railway image digest from every service (blocking),
//   3. GET /api/health with every readiness boolean true (blocking when a URL
//      is known: --app-url or BETA_APP_URL),
//   4. every ai_execution_control_heads row enabled/accepting (blocking when
//      DATABASE_URL is set; skipped, printed, otherwise).

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import {
  DATA_CELL_CATALOGUE,
  DATA_CELL_IDS,
  type DataCellId,
} from '../../src/shared/domain/data-cell-catalogue'
import {
  RAILWAY_SERVICE_IMAGE_ROLES,
  parsePromotionManifest,
  promotedImageReference,
  sigstoreManifestVerificationArgs,
  type PromotionManifest,
  type RailwayApplicationService,
} from '../../src/shared/release/promotion-manifest'

const COMMAND_NAME = 'release:beta'
const ALL_SERVICES = Object.freeze(
  Object.keys(RAILWAY_SERVICE_IMAGE_ROLES) as RailwayApplicationService[],
)

const HEADS_QUERY =
  'select scope_key, execution_state, admission_state from ai_execution_control_heads order by 1'

/** Railway deployment states that will never change again. */
const TERMINAL_STATUSES = new Set(['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED', 'SKIPPED'])

const DEFAULT_DEPLOY_TIMEOUT_SECONDS = 900
const POLL_INTERVAL_MS = 10_000

/** Flags this script owns; stripped before argv reaches the operator harness. */
const OWN_VALUE_FLAGS = [
  '--app-url',
  '--deploy-timeout',
  '--manifest',
  '--signature-bundle',
  '--manifest-sha256',
  '--cell',
] as const
const OWN_BOOLEAN_FLAGS = ['--verify-only'] as const

export type ServicePlan = {
  readonly service: RailwayApplicationService
  readonly variables: readonly string[]
  readonly imageReference: string
  readonly imageDigest: string
}

type Deployment = { readonly service: string; readonly deploymentId: string | undefined }

type HeadRow = {
  readonly scope_key: string
  readonly execution_state: string
  readonly admission_state: string
}

type Options = {
  readonly apply: boolean
  readonly verifyOnly: boolean
  readonly appUrl: string | undefined
  readonly deployTimeoutMs: number
  readonly manifestPath: string
  readonly signatureBundlePath: string
  readonly manifestSha256: string
  readonly cell: DataCellId
  readonly environment: `cell-${DataCellId}`
}

export function deployPlan(
  manifest: PromotionManifest,
  manifestSha256: string,
): readonly ServicePlan[] {
  return ALL_SERVICES.map((service) => ({
    service,
    variables: [
      `RELEASE_SHA=${manifest.releaseSha}`,
      `RELEASE_MANIFEST_SHA256=${manifestSha256}`,
    ],
    imageReference: promotedImageReference(manifest, service),
    imageDigest: manifest.images[RAILWAY_SERVICE_IMAGE_ROLES[service]].digest,
  }))
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
  const manifestPath = flagValue(args, '--manifest')
  const signatureBundlePath = flagValue(args, '--signature-bundle')
  const manifestSha256 = flagValue(args, '--manifest-sha256')
  const cell = flagValue(args, '--cell')
  if (!manifestPath || !signatureBundlePath || !manifestSha256 || !cell) {
    return '--manifest, --signature-bundle, --manifest-sha256, and --cell are required'
  }
  if (!/^[0-9a-f]{64}$/u.test(manifestSha256)) {
    return '--manifest-sha256 must be a lowercase sha256'
  }
  if (!DATA_CELL_IDS.includes(cell as DataCellId)) {
    return `--cell must be one of: ${DATA_CELL_IDS.join(', ')}`
  }
  const dataCell = cell as DataCellId
  const options: Options = {
    apply: args.includes('--apply'),
    verifyOnly: args.includes('--verify-only'),
    appUrl:
      flagValue(args, '--app-url') ??
      process.env.BETA_APP_URL ??
      `https://${DATA_CELL_CATALOGUE[dataCell].domain}`,
    deployTimeoutMs: timeoutSeconds * 1000,
    manifestPath: resolve(manifestPath),
    signatureBundlePath: resolve(signatureBundlePath),
    manifestSha256,
    cell: dataCell,
    environment: `cell-${dataCell}`,
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

/** Run a Railway command; throw naming the command and its stderr on failure. */
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

function parseDeploymentId(output: string): string | undefined {
  try {
    const value = JSON.parse(output) as unknown
    if (value && typeof value === 'object') {
      for (const field of ['deploymentId', 'id'] as const) {
        const candidate = (value as Record<string, unknown>)[field]
        if (typeof candidate === 'string' && /^[0-9a-f-]{36}$/iu.test(candidate)) {
          return candidate
        }
      }
    }
  } catch {
    // Some CLI versions write a human build-log URL rather than JSON.
  }
  return /[?&]id=([0-9a-f-]{36})/iu.exec(output)?.[1]
}

/**
 * Write release identity without triggering intermediate deployments, then
 * connect the exact registry digest. No local source archive is uploaded.
 */
function deployService(plan: ServicePlan, environment: string): Deployment {
  for (const assignment of plan.variables) {
    railway([
      'variable',
      'set',
      assignment,
      '--service',
      plan.service,
      '--environment',
      environment,
      '--skip-deploys',
    ])
  }
  const stdout = railway([
    'service',
    'source',
    'connect',
    '--image',
    plan.imageReference,
    '--service',
    plan.service,
    '--environment',
    environment,
    '--json',
  ])
  process.stdout.write(stdout.endsWith('\n') || stdout === '' ? stdout : `${stdout}\n`)
  const deploymentId = parseDeploymentId(stdout)
  if (!deploymentId) {
    out(
      `   WARNING: could not parse a deployment id for ${plan.service}; settlement will use the first deployment carrying ${plan.imageDigest}`,
    )
  }
  return { service: plan.service, deploymentId }
}

type DeploymentRow = {
  readonly id?: string
  readonly status?: string
  readonly meta?: Readonly<{ imageDigest?: string }>
}

function deploymentStatus(
  deployment: Deployment,
  environment: string,
  expectedDigest?: string,
): string {
  const listed = railway([
    'deployment',
    'list',
    '--service',
    deployment.service,
    '--environment',
    environment,
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
    : rows.find((entry) => entry.meta?.imageDigest === expectedDigest)
  return row?.status ?? 'UNKNOWN'
}

/**
 * Block until every deployment reaches a terminal state. Returns the failures,
 * so one bad service is reported alongside the rest rather than hiding them.
 */
async function awaitSettlement(
  deployments: readonly Deployment[],
  plans: readonly ServicePlan[],
  environment: string,
  timeoutMs: number,
): Promise<readonly string[]> {
  const deadline = Date.now() + timeoutMs
  const pending = new Map(deployments.map((d) => [d.service, d]))
  const failures: string[] = []
  out('')
  out('waiting for deployments to settle:')
  while (pending.size > 0) {
    for (const [service, deployment] of [...pending]) {
      const expectedDigest = plans.find((plan) => plan.service === service)?.imageDigest
      const status = deploymentStatus(deployment, environment, expectedDigest)
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
        const expectedDigest = plans.find((plan) => plan.service === service)?.imageDigest
        failures.push(
          `${service}: deployment ${deployment.deploymentId ?? `(digest ${expectedDigest ?? 'unknown'})`} still ${deploymentStatus(deployment, environment, expectedDigest)} after ${String(Math.round(timeoutMs / 1000))}s`,
        )
      }
      break
    }
    await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS))
  }
  return failures
}

type ReleaseVariable =
  'RELEASE_SHA' | 'RELEASE_MANIFEST_SHA256' | 'SOURCE_REVISION' | 'IMAGE_SOURCE_REVISION'

function readReleaseVariables(
  service: string,
  environment: string,
): Readonly<Record<ReleaseVariable, string>> {
  const listed = railway([
    'variable',
    'list',
    '--service',
    service,
    '--environment',
    environment,
    '--kv',
  ])
  const values = Object.fromEntries(
    listed
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf('=')
        return separator === -1
          ? [entry, '']
          : [entry.slice(0, separator), entry.slice(separator + 1)]
      }),
  )
  return {
    RELEASE_SHA: values.RELEASE_SHA ?? '',
    RELEASE_MANIFEST_SHA256: values.RELEASE_MANIFEST_SHA256 ?? '',
    SOURCE_REVISION: values.SOURCE_REVISION ?? '',
    IMAGE_SOURCE_REVISION: values.IMAGE_SOURCE_REVISION ?? '',
  }
}

/**
 * Refuse before the first mutation when legacy service variables could mask
 * the revision baked into a promoted image. IaC and the release controller
 * deliberately do not own these variables anymore.
 */
function legacyIdentityOverrideFailures(environment: string): readonly string[] {
  const failures: string[] = []
  for (const service of ALL_SERVICES) {
    const variables = readReleaseVariables(service, environment)
    const names = (['SOURCE_REVISION', 'IMAGE_SOURCE_REVISION'] as const).filter(
      (name) => variables[name] !== '',
    )
    if (names.length > 0) {
      failures.push(
        `${service}: remove legacy service override${names.length === 1 ? '' : 's'} ${names.join(', ')} before promotion; image source identity must be baked only`,
      )
    }
  }
  return failures
}

/** Read-back table. Returns the failures so every service is reported, not the first. */
function verifyReleaseIdentity(
  environment: string,
  expectedSha: string,
  expectedManifestSha256: string,
): readonly string[] {
  const observed = ALL_SERVICES.map((service) => {
    const variables = readReleaseVariables(service, environment)
    return {
      service,
      sha: variables.RELEASE_SHA,
      manifestSha256: variables.RELEASE_MANIFEST_SHA256,
      sourceRevisionOverride: variables.SOURCE_REVISION,
      imageRevisionOverride: variables.IMAGE_SOURCE_REVISION,
    }
  })
  for (const row of observed) {
    out(
      `  ${row.service.padEnd(28)} ${row.sha || '(unset)'} manifest=${row.manifestSha256 || '(unset)'}`,
    )
  }
  const failures: string[] = []
  for (const row of observed) {
    if (row.sha !== expectedSha) {
      failures.push(
        `${row.service}: RELEASE_SHA=${row.sha || '(unset)'} != ${expectedSha}`,
      )
    }
    if (row.manifestSha256 !== expectedManifestSha256) {
      failures.push(
        `${row.service}: RELEASE_MANIFEST_SHA256=${row.manifestSha256 || '(unset)'} != ${expectedManifestSha256}`,
      )
    }
    if (row.sourceRevisionOverride || row.imageRevisionOverride) {
      failures.push(
        `${row.service}: legacy SOURCE_REVISION/IMAGE_SOURCE_REVISION service override must be absent; source identity is baked into the promoted image`,
      )
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

function activeDeploymentRow(
  service: RailwayApplicationService,
  environment: string,
): DeploymentRow | undefined {
  const status = JSON.parse(
    railway([
      'service',
      'status',
      '--service',
      service,
      '--environment',
      environment,
      '--json',
    ]),
  ) as Readonly<{ deploymentId?: string }>
  if (!status.deploymentId) return undefined
  const rows = JSON.parse(
    railway([
      'deployment',
      'list',
      '--service',
      service,
      '--environment',
      environment,
      '--json',
    ]),
  ) as readonly DeploymentRow[]
  return rows.find((row) => row.id === status.deploymentId)
}

function verifyImageDigests(
  plan: readonly ServicePlan[],
  environment: string,
): readonly string[] {
  const failures: string[] = []
  for (const entry of plan) {
    const row = activeDeploymentRow(entry.service, environment)
    const observed = row?.meta?.imageDigest ?? ''
    out(`  ${entry.service.padEnd(28)} ${observed || '(unavailable)'}`)
    if (row?.status !== 'SUCCESS') {
      failures.push(`${entry.service}: active deployment is not SUCCESS`)
    }
    if (observed !== entry.imageDigest) {
      failures.push(
        `${entry.service}: active image digest ${observed || '(unavailable)'} != ${entry.imageDigest}`,
      )
    }
  }
  return failures
}

async function verify(
  manifest: PromotionManifest,
  manifestSha256: string,
  options: Options,
): Promise<readonly string[]> {
  const failures: string[] = []
  const plan = deployPlan(manifest, manifestSha256)

  out('')
  out(`release identity (${options.environment}; expecting ${manifest.releaseSha}):`)
  failures.push(
    ...verifyReleaseIdentity(options.environment, manifest.releaseSha, manifestSha256),
  )

  out('')
  out('active Railway image digests:')
  failures.push(...verifyImageDigests(plan, options.environment))

  out('')
  if (options.appUrl) {
    out('health:')
    failures.push(...(await verifyHealth(options.appUrl)))
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
        ? `verified: every deployment SUCCESS, one revision across all ${String(ALL_SERVICES.length)} services, health green, AI heads accepting`
        : `verified: one revision across all ${String(ALL_SERVICES.length)} services, health green, AI heads accepting (no deploy in this run)`,
    )
    return 0
  }
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`)
  return 1
}

function loadManifest(options: Options): PromotionManifest | string {
  let content: string
  try {
    content = readFileSync(options.manifestPath, 'utf8')
  } catch (error) {
    return `could not read promotion manifest: ${error instanceof Error ? error.message : String(error)}`
  }
  const parsed = parsePromotionManifest(content)
  if (!parsed.ok) return parsed.errors.join('\n')
  if (parsed.digest !== options.manifestSha256) {
    return `promotion manifest digest ${parsed.digest} does not match --manifest-sha256`
  }
  return parsed.manifest
}

function assertSafeCosignVersion(): void {
  const result = spawnSync('cosign', ['version'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error('cosign 3.1.3 or newer is required to verify the release manifest')
  }
  const version = /(?:GitVersion:\s*|cosign version\s+v?)(\d+)\.(\d+)\.(\d+)/iu.exec(
    `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  )
  if (!version) throw new Error('could not determine cosign version')
  const [major, minor, patch] = version.slice(1).map(Number)
  if (
    major === undefined ||
    minor === undefined ||
    patch === undefined ||
    major < 3 ||
    (major === 3 && (minor < 1 || (minor === 1 && patch < 3)))
  ) {
    throw new Error('cosign 3.1.3 or newer is required to verify the release manifest')
  }
}

function verifyManifestSignature(options: Options): void {
  assertSafeCosignVersion()
  const args = sigstoreManifestVerificationArgs({
    manifestPath: options.manifestPath,
    bundlePath: options.signatureBundlePath,
  })
  const result = spawnSync('cosign', [...args], { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(
      `release manifest signature verification failed${detail ? `: ${detail}` : ''}`,
    )
  }
}

async function deployAndVerify(
  manifest: PromotionManifest,
  options: Options,
): Promise<number> {
  const plan = deployPlan(manifest, options.manifestSha256)
  out(
    `APPLY — environment ${options.environment}, revision ${manifest.releaseSha}, manifest ${options.manifestSha256}`,
  )

  out('')
  out('preflight: legacy image-identity overrides')
  const legacyOverrideFailures = legacyIdentityOverrideFailures(options.environment)
  if (legacyOverrideFailures.length > 0) {
    return report(legacyOverrideFailures, false)
  }
  out('  clear — promoted image metadata is the sole source identity')

  // Provider Redis is independent of the schema and must be ready before an
  // enabled Google path can reach the new web. Web then owns the pre-deploy
  // migration and finishes readiness before workers/effect services advance.
  const [providerRedis, web, ...remaining] = plan
  if (
    !providerRedis ||
    providerRedis.service !== 'google-provider-redis' ||
    !web ||
    web.service !== 'web'
  ) {
    throw new Error('release plan must start with provider Redis, then web')
  }

  out('')
  out(
    `1/${String(plan.length)} ${providerRedis.service}: ${providerRedis.imageReference} ${providerRedis.variables.join(' ')}`,
  )
  const providerSettlement = await awaitSettlement(
    [deployService(providerRedis, options.environment)],
    [providerRedis],
    options.environment,
    options.deployTimeoutMs,
  )
  if (providerSettlement.length > 0) return report(providerSettlement, false)

  out('')
  out(
    `2/${String(plan.length)} ${web.service}: ${web.imageReference} ${web.variables.join(' ')}`,
  )
  const webSettlement = await awaitSettlement(
    [deployService(web, options.environment)],
    [web],
    options.environment,
    options.deployTimeoutMs,
  )
  if (webSettlement.length > 0) {
    return report(webSettlement, false)
  }

  for (const [index, entry] of remaining.entries()) {
    out('')
    out(
      `${String(index + 3)}/${String(plan.length)} ${entry.service}: ${entry.imageReference} ${entry.variables.join(' ')}`,
    )
    const settlement = await awaitSettlement(
      [deployService(entry, options.environment)],
      [entry],
      options.environment,
      options.deployTimeoutMs,
    )
    if (settlement.length > 0) return report(settlement, false)
  }

  return report(await verify(manifest, options.manifestSha256, options), true)
}

function printPlan(manifest: PromotionManifest, options: Options): number {
  const plan = deployPlan(manifest, options.manifestSha256)
  out(
    `DRY RUN — environment ${options.environment}, revision ${manifest.releaseSha}, manifest ${options.manifestSha256}`,
  )
  out('Re-run with --apply --operator <id> --reason "<text>" to execute.')
  out('No Railway command has been invoked. Apply will verify the Sigstore bundle.')
  for (const [index, entry] of plan.entries()) {
    out('')
    out(`${String(index + 1)}. ${entry.service}`)
    for (const assignment of entry.variables) {
      out(
        `   railway variable set ${assignment} --service ${entry.service} --environment ${options.environment} --skip-deploys`,
      )
    }
    out(
      `   railway service source connect --image ${entry.imageReference} --service ${entry.service} --environment ${options.environment} --json`,
    )
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
  const loaded = loadManifest(options)
  if (typeof loaded === 'string') {
    process.stderr.write(`invalid release manifest:\n${loaded}\n`)
    return 1
  }
  const manifest = loaded

  if (options.verifyOnly) {
    verifyManifestSignature(options)
    out(`verify-only — environment ${options.environment}`)
    return report(await verify(manifest, options.manifestSha256, options), false)
  }

  if (!options.apply) return printPlan(manifest, options)

  // Cheapest refusals first: argv and manifest, then signature, then network.
  //
  // The operator requirements are validated HERE rather than by the harness
  // because the harness boots the policy runtime (full env schema +
  // DATABASE_URL) before it parses argv, so a forgotten --reason would surface
  // as an env error.
  const missing = ['--operator', '--reason'].filter((flag) => !flagValue(args, flag))
  if (missing.length > 0) {
    process.stderr.write(
      `${COMMAND_NAME} --apply is an audited operator action and needs ${missing.join(' and ')}.\n` +
        `Usage: pnpm ${COMMAND_NAME} --apply --operator <id> --reason "<text>"\n` +
        'The operator must be listed in OPS_OPERATOR_IDENTITIES and DATABASE_URL must be reachable\n' +
        'so the decision lands in policy_decision_audit.\n',
    )
    return 2
  }

  // Signature verification is never bypassable. It is the authority for
  // source and image provenance.
  verifyManifestSignature(options)

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
      usage: `pnpm ${COMMAND_NAME} --manifest <manifest.json> --signature-bundle <bundle.json> --manifest-sha256 <digest> --cell <us|europe|global> --apply --operator <id> --reason "<text>" [--app-url <url>] [--deploy-timeout <seconds>]`,
    },
    async () => deployAndVerify(manifest, options),
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
