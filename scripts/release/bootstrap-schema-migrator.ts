// release:migrate-cell — run the deploy-equivalent migration binary as one
// signed Railway job before the first single-US Data Cell cutover.
//
// This deliberately does not upload a checkout or build on Railway. It binds
// the exact web image digest from the canonical signed promotion manifest to
// IaC's one-shot `schema-migrator`, waits for that deployment to exit SUCCESS,
// and verifies the deployment metadata reports the same digest. The normal
// `release:beta` gate remains unchanged and still reruns the idempotent
// migration as web's pre-deploy step.

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  closeSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BETA_DEPLOYMENT_DATA_CELL_IDS,
  isBetaDeploymentDataCellId,
  type BetaDeploymentDataCellId,
} from '../../src/shared/domain/data-cell-catalogue'
import {
  canonicalPromotionManifest,
  parsePromotionManifest,
  promotionManifestSha256,
  sigstoreManifestVerificationArgs,
  type PromotionManifest,
} from '../../src/shared/release/promotion-manifest'
import {
  assertRailwayPlanEvidenceFresh,
  classifyRailwayPlanExit,
  parseRailwayPlanEvidence,
  railwayPlanArgs,
  railwayPlanEvidenceSha256,
  type RailwayPlanEvidence,
} from '../../src/shared/release/railway-plan-evidence'
import {
  assertRailwayFullProjectVisibilityCredential,
  assertSingleUsBetaRailwayProjectIsolation,
  parseRailwayProjectServiceInventory,
  railwayFullProjectStatusArgs,
} from '../../src/shared/release/railway-project-service-isolation'
import {
  SCHEMA_MIGRATION_BOOTSTRAP_AUDIT_VERSION,
  canonicalSchemaMigrationBootstrapAuthorization,
  createSchemaMigrationBootstrapAuthorization,
  schemaMigrationBootstrapAuthorizationSha256,
} from '../../src/shared/release/schema-migration-bootstrap-audit'
import {
  assertRailwayTargetMatchesPlanEvidence,
  parseRailwayLinkedTarget,
  railwayTargetEnvironment,
} from './railway-data-cell-plan'
import { railwayIacSourceDigest } from './iac-digest'
import {
  assertReleaseControllerSourceDigest,
  releaseControllerSourceDigest,
} from './release-authority-digest'
import {
  assertPinnedRailwayApplyResult,
  assertRailwayCliSupportsPinnedPlans,
  assertRailwaySavedPlanArtifactUnchanged,
  bindRailwaySavedPlanArtifact,
  fullRailwayServiceSourceInput,
  inspectFullCandidateRailwayPlan,
  inspectStagedRailwayPlan,
  railwayPinnedApplyArgs,
  railwayPinnedPlanArgs,
  railwaySourceMapEnvironment,
  stagedRailwayServiceSourceInput,
  type RailwayIacTarget,
} from './staged-railway-sources'
import {
  RAILWAY_SERVICE_SOURCE_MAP_ENV,
  type RailwayServiceSourceInput,
  type RailwayServiceSourceMap,
} from '../../.railway/service-source-map'

const COMMAND_NAME = 'release:migrate-cell'
const SERVICE = 'schema-migrator' as const
const IAC_FILE = '.railway/railway.ts'
const DEFAULT_TIMEOUT_SECONDS = 900
const MAX_TIMEOUT_SECONDS = 3_600
const POLL_INTERVAL_MS = 10_000
const SHA256 = /^[0-9a-f]{64}$/u
const DEPLOYMENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const IN_PROGRESS_STATUSES = new Set([
  'QUEUED',
  'INITIALIZING',
  'WAITING',
  'BUILDING',
  'DEPLOYING',
])

const OWN_VALUE_FLAGS = [
  '--manifest',
  '--signature-bundle',
  '--manifest-sha256',
  '--railway-plan-evidence',
  '--railway-plan-evidence-sha256',
  '--audit-evidence',
  '--cell',
  '--deploy-timeout',
] as const

export type SchemaMigratorPlan = Readonly<{
  service: typeof SERVICE
  imageReference: string
  imageDigest: string
}>

export type RailwayExecutor = (args: readonly string[], env: NodeJS.ProcessEnv) => string

export type RailwayPlanExecutor = (
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Readonly<{ stdout: string; status: number }>

export type SchemaMigrationBootstrapResult = Readonly<{
  deploymentId: string
  imageDigest: string
  status: 'SUCCESS'
}>

type ParsedOptions = Readonly<{
  apply: boolean
  manifestPath: string
  signatureBundlePath: string
  manifestSha256: string
  railwayPlanEvidencePath: string
  railwayPlanEvidenceSha256: string
  auditEvidencePath?: string
  cell: BetaDeploymentDataCellId
  timeoutMs: number
}>

type LoadedOptions = ParsedOptions &
  Readonly<{
    manifest: PromotionManifest
    evidence: RailwayPlanEvidence
  }>

type DeploymentRow = Readonly<{
  id?: string
  status?: string
  meta?: Readonly<{ imageDigest?: string }>
}>

function out(line = ''): void {
  process.stdout.write(`${line}\n`)
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  const value = index < 0 ? undefined : args[index + 1]
  return value?.startsWith('--') ? undefined : value
}

export function deployTimeoutMilliseconds(value: string | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_SECONDS * 1000
  const seconds = Number(value)
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > MAX_TIMEOUT_SECONDS) {
    throw new Error(
      `--deploy-timeout must be a positive integer no greater than ${String(MAX_TIMEOUT_SECONDS)} seconds`,
    )
  }
  return seconds * 1000
}

function parseOptions(args: readonly string[]): ParsedOptions | string {
  const manifestPath = flagValue(args, '--manifest')
  const signatureBundlePath = flagValue(args, '--signature-bundle')
  const manifestSha256 = flagValue(args, '--manifest-sha256')
  const evidencePath = flagValue(args, '--railway-plan-evidence')
  const evidenceSha256 = flagValue(args, '--railway-plan-evidence-sha256')
  const auditEvidencePath = flagValue(args, '--audit-evidence')
  const cellValue = flagValue(args, '--cell')
  if (
    !manifestPath ||
    !signatureBundlePath ||
    !manifestSha256 ||
    !evidencePath ||
    !evidenceSha256 ||
    !cellValue
  ) {
    return '--manifest, --signature-bundle, --manifest-sha256, --railway-plan-evidence, --railway-plan-evidence-sha256, and --cell are required'
  }
  if (!SHA256.test(manifestSha256)) {
    return '--manifest-sha256 must be a lowercase sha256'
  }
  if (!SHA256.test(evidenceSha256)) {
    return '--railway-plan-evidence-sha256 must be a lowercase sha256'
  }
  if (!isBetaDeploymentDataCellId(cellValue)) {
    return `--cell must be one of: ${BETA_DEPLOYMENT_DATA_CELL_IDS.join(', ')}`
  }
  let timeoutMs: number
  try {
    timeoutMs = deployTimeoutMilliseconds(flagValue(args, '--deploy-timeout'))
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return {
    apply: args.includes('--apply'),
    manifestPath: resolve(manifestPath),
    signatureBundlePath: resolve(signatureBundlePath),
    manifestSha256,
    railwayPlanEvidencePath: resolve(evidencePath),
    railwayPlanEvidenceSha256: evidenceSha256,
    auditEvidencePath: auditEvidencePath ? resolve(auditEvidencePath) : undefined,
    cell: cellValue,
    timeoutMs,
  }
}

function currentMigrationHead(): string {
  const journal = JSON.parse(
    readFileSync(resolve('drizzle/meta/_journal.json'), 'utf8'),
  ) as Readonly<{ entries?: readonly Readonly<{ tag?: string }>[] }>
  const head = journal.entries?.at(-1)?.tag
  if (!head) throw new Error('Drizzle migration head is unavailable')
  return head
}

export function schemaMigratorPlan(manifest: PromotionManifest): SchemaMigratorPlan {
  const image = manifest.images.web
  return Object.freeze({
    service: SERVICE,
    imageReference: `${image.repository}@${image.digest}`,
    imageDigest: image.digest,
  })
}

/** Bind retained review, signed release, local IaC, and migration source. */
export function validateSchemaMigrationBootstrapContract(
  manifest: PromotionManifest,
  evidence: RailwayPlanEvidence,
  input: Readonly<{
    cell: BetaDeploymentDataCellId
    currentIacSha256: string
    currentReleaseControllerSha256: string
    currentMigrationHead: string
    now: Date
  }>,
): void {
  if (evidence.cell !== input.cell) {
    throw new Error(
      `Railway plan cell ${evidence.cell} does not match requested cell ${input.cell}`,
    )
  }
  const manifestSha256 = promotionManifestSha256(canonicalPromotionManifest(manifest))
  if (evidence.release.manifestSha256 !== manifestSha256) {
    throw new Error(
      `Railway plan manifest digest ${evidence.release.manifestSha256} does not match promotion manifest digest ${manifestSha256}`,
    )
  }
  if (evidence.release.controllerSha256 !== manifest.contract.releaseControllerSha256) {
    throw new Error(
      `Railway plan controller digest ${evidence.release.controllerSha256} does not match signed manifest controller digest ${manifest.contract.releaseControllerSha256}`,
    )
  }
  assertReleaseControllerSourceDigest(
    manifest.contract.releaseControllerSha256,
    input.currentReleaseControllerSha256,
  )
  if (evidence.iac.sha256 !== manifest.contract.iacSha256) {
    throw new Error(
      `Railway plan IaC digest ${evidence.iac.sha256} does not match signed manifest IaC digest ${manifest.contract.iacSha256}`,
    )
  }
  if (input.currentIacSha256 !== manifest.contract.iacSha256) {
    throw new Error(
      `current Railway IaC digest ${input.currentIacSha256} does not match signed manifest IaC digest ${manifest.contract.iacSha256}`,
    )
  }
  if (input.currentMigrationHead !== manifest.contract.migrationHead) {
    throw new Error(
      `current migration head ${input.currentMigrationHead} does not match signed manifest migration head ${manifest.contract.migrationHead}`,
    )
  }
  assertRailwayPlanEvidenceFresh(evidence, input.now)
}

function loadOptions(parsed: ParsedOptions): LoadedOptions | string {
  let manifestContent: string
  let evidenceContent: string
  try {
    manifestContent = readFileSync(parsed.manifestPath, 'utf8')
  } catch (error) {
    return `could not read promotion manifest: ${error instanceof Error ? error.message : String(error)}`
  }
  try {
    evidenceContent = readFileSync(parsed.railwayPlanEvidencePath, 'utf8')
  } catch (error) {
    return `could not read Railway plan evidence: ${error instanceof Error ? error.message : String(error)}`
  }

  const manifest = parsePromotionManifest(manifestContent)
  if (!manifest.ok) return manifest.errors.join('\n')
  if (manifest.digest !== parsed.manifestSha256) {
    return `promotion manifest digest ${manifest.digest} does not match --manifest-sha256`
  }
  const evidence = parseRailwayPlanEvidence(evidenceContent)
  if (!evidence.ok) return evidence.errors.join('\n')
  if (evidence.digest !== parsed.railwayPlanEvidenceSha256) {
    return `Railway plan evidence digest ${evidence.digest} does not match --railway-plan-evidence-sha256`
  }
  try {
    validateSchemaMigrationBootstrapContract(manifest.manifest, evidence.evidence, {
      cell: parsed.cell,
      currentIacSha256: railwayIacSourceDigest(),
      currentReleaseControllerSha256: releaseControllerSourceDigest(),
      currentMigrationHead: currentMigrationHead(),
      now: new Date(),
    })
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return { ...parsed, manifest: manifest.manifest, evidence: evidence.evidence }
}

function assertSafeCosignVersion(): void {
  const result = spawnSync('cosign', ['version'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error('cosign 3.1.3 or newer is required to verify the release manifest')
  }
  const version = /(?:GitVersion:\s*v?|cosign version\s+v?)(\d+)\.(\d+)\.(\d+)/iu.exec(
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

export function rebindPromotionManifestAtDigest(
  content: string,
  expectedDigest: string,
): PromotionManifest {
  const parsed = parsePromotionManifest(content)
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
  if (parsed.digest !== expectedDigest) {
    throw new Error(
      `verified promotion manifest digest ${parsed.digest} does not match expected ${expectedDigest}`,
    )
  }
  return parsed.manifest
}

function verifyManifestSignature(options: ParsedOptions): Readonly<{
  manifest: PromotionManifest
  signatureBundleSha256: string
}> {
  assertSafeCosignVersion()
  const manifestContent = readFileSync(options.manifestPath, 'utf8')
  const bundleContent = readFileSync(options.signatureBundlePath)
  const manifest = rebindPromotionManifestAtDigest(
    manifestContent,
    options.manifestSha256,
  )
  const directory = mkdtempSync(join(tmpdir(), 'repkey-schema-bootstrap-signature-'))
  const manifestPath = join(directory, 'manifest.json')
  const bundlePath = join(directory, 'bundle.json')
  try {
    writeFileSync(manifestPath, manifestContent, { flag: 'wx', mode: 0o600 })
    writeFileSync(bundlePath, bundleContent, { flag: 'wx', mode: 0o600 })
    const result = spawnSync(
      'cosign',
      sigstoreManifestVerificationArgs({ manifestPath, bundlePath }),
      { encoding: 'utf8' },
    )
    if (result.error || result.status !== 0) {
      const detail = (result.stderr || result.stdout || '').trim()
      throw new Error(
        `release manifest signature verification failed${detail ? `: ${detail}` : ''}`,
      )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  return {
    manifest,
    signatureBundleSha256: createHash('sha256').update(bundleContent).digest('hex'),
  }
}

function durableCreate(path: string, content: string): void {
  const descriptor = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(descriptor, content, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

/** Create the authorization and digest sidecar without an overwrite path. */
export function writeBootstrapAuthorizationEvidence(
  path: string,
  content: string,
): string {
  const digest = schemaMigrationBootstrapAuthorizationSha256(content)
  durableCreate(path, content)
  durableCreate(`${path}.sha256`, `${digest}  ${basename(path)}\n`)
  return digest
}

function defaultRailwayExecutor(args: readonly string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync('railway', [...args], { encoding: 'utf8', env })
  const printable = `railway ${args.join(' ')}`
  if (result.error) throw new Error(`${printable}: ${result.error.message}`)
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`${printable} exited ${String(result.status)}\n${detail}`)
  }
  return result.stdout ?? ''
}

function defaultRailwayPlanExecutor(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Readonly<{ stdout: string; status: number }> {
  const result = spawnSync('railway', [...args], { encoding: 'utf8', env })
  const printable = `railway ${args.join(' ')}`
  if (result.error) throw new Error(`${printable}: ${result.error.message}`)
  const status = result.status ?? 1
  if (status !== 0 && status !== 2) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`${printable} exited ${String(status)}\n${detail}`)
  }
  return Object.freeze({ stdout: result.stdout ?? '', status })
}

/** Test/in-process executors can omit OS exit status; infer only from plan JSON. */
function inferredRailwayPlanExecutor(railway: RailwayExecutor): RailwayPlanExecutor {
  return (args, env) => {
    const stdout = railway(args, env)
    let value: unknown
    try {
      value = JSON.parse(stdout)
    } catch {
      throw new Error('injected Railway plan executor did not return JSON')
    }
    const changeSet =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Readonly<Record<string, unknown>>).changeSet
        : undefined
    const changes =
      changeSet && typeof changeSet === 'object' && !Array.isArray(changeSet)
        ? (changeSet as Readonly<Record<string, unknown>>).changes
        : undefined
    if (!Array.isArray(changes)) {
      throw new Error('injected Railway plan executor omitted changeSet.changes')
    }
    return Object.freeze({ stdout, status: changes.length === 0 ? 0 : 2 })
  }
}

function pinnedEnvironment(
  evidence: RailwayPlanEvidence,
  sourceInput: RailwayServiceSourceInput,
): NodeJS.ProcessEnv {
  return {
    ...railwayTargetEnvironment({
      project: evidence.target.projectId,
      name: evidence.target.projectName,
      environment: evidence.target.environmentId,
    }),
    RAILWAY_CALLER: process.env.RAILWAY_CALLER ?? 'repo:release-migrate-cell',
    RAILWAY_AGENT_SESSION:
      process.env.RAILWAY_AGENT_SESSION ??
      `repkey-schema-bootstrap-${evidence.deploymentProfile}-${evidence.cell}`,
    REPKEY_RAILWAY_CELL_ENVIRONMENT: evidence.target.environment,
    REPKEY_RAILWAY_DEPLOYMENT_PROFILE: evidence.deploymentProfile,
    [RAILWAY_SERVICE_SOURCE_MAP_ENV]: railwaySourceMapEnvironment(sourceInput),
  }
}

function parseDeploymentRows(output: string): readonly DeploymentRow[] {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error('could not parse Railway schema-migrator deployment list')
  }
  if (!Array.isArray(value)) {
    throw new Error('Railway schema-migrator deployment list must be an array')
  }
  return value as readonly DeploymentRow[]
}

function assertRedeployFromSourceAcknowledged(output: string): void {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error('Railway schema-migrator recovery redeploy did not return JSON')
  }
  if (
    !value ||
    typeof value !== 'object' ||
    (value as Record<string, unknown>).success !== true
  ) {
    throw new Error('Railway schema-migrator recovery redeploy was not acknowledged')
  }
}

function deploymentListArgs(target: RailwayPlanEvidence['target']): readonly string[] {
  return [
    'deployment',
    'list',
    '--service',
    SERVICE,
    '--project',
    target.projectId,
    '--environment',
    target.environmentId,
    '--limit',
    '100',
    '--json',
  ]
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise((done) => setTimeout(done, milliseconds))
}

function railwayIacTarget(evidence: RailwayPlanEvidence): RailwayIacTarget {
  return Object.freeze({
    projectId: evidence.target.projectId,
    projectName: evidence.target.projectName,
    environmentId: evidence.target.environmentId,
    environment: evidence.target.environment,
  })
}

function assertReviewedCandidatePlan(
  result: Readonly<{ stdout: string; status: number }>,
  evidence: RailwayPlanEvidence,
  candidate: RailwayServiceSourceInput,
): RailwayServiceSourceMap {
  const inspected = inspectFullCandidateRailwayPlan(
    result.stdout,
    railwayIacTarget(evidence),
    candidate,
  )
  const outcome = classifyRailwayPlanExit(result.status)
  if (outcome !== evidence.plan.outcome) {
    throw new Error(
      `live Railway plan outcome ${outcome} does not match retained ${evidence.plan.outcome}`,
    )
  }
  if (
    inspected.rawSha256 !== evidence.plan.rawSha256 ||
    railwayPlanEvidenceSha256(result.stdout) !== evidence.plan.rawSha256
  ) {
    throw new Error('live Railway plan bytes do not match retained plan evidence')
  }
  if (
    (result.status === 0 && inspected.changeCount !== 0) ||
    (result.status === 2 && inspected.changeCount === 0)
  ) {
    throw new Error('Railway plan exit code disagrees with its change set')
  }
  return inspected.currentSources
}

/**
 * Re-prove the exact isolated target and retained candidate plan, advance only
 * the schema-migrator source through a saved IaC plan, and settle the one-shot
 * job at the signed digest.
 */
export async function executeSignedSchemaMigrationBootstrap(
  input: Readonly<{
    manifest: PromotionManifest
    evidence: RailwayPlanEvidence
    timeoutMs: number
    railway?: RailwayExecutor
    railwayPlan?: RailwayPlanExecutor
    railwayIacDigest?: () => string
    sleep?: (milliseconds: number) => Promise<void>
    now?: () => number
  }>,
): Promise<SchemaMigrationBootstrapResult> {
  const railway = input.railway ?? defaultRailwayExecutor
  const railwayPlan =
    input.railwayPlan ??
    (input.railway
      ? inferredRailwayPlanExecutor(input.railway)
      : defaultRailwayPlanExecutor)
  const sleep = input.sleep ?? defaultSleep
  const now = input.now ?? Date.now
  const currentIacDigest = input.railwayIacDigest ?? railwayIacSourceDigest
  const candidate = fullRailwayServiceSourceInput(input.manifest)
  let environment = pinnedEnvironment(input.evidence, candidate)
  assertRailwayFullProjectVisibilityCredential(environment)
  const target = input.evidence.target
  const run = (args: readonly string[]): string => railway(args, environment)
  const runPlan = (
    args: readonly string[],
  ): Readonly<{ stdout: string; status: number }> => railwayPlan(args, environment)
  const assertProjectIsolation = (): void => {
    assertSingleUsBetaRailwayProjectIsolation(
      parseRailwayProjectServiceInventory(run(railwayFullProjectStatusArgs())),
      {
        projectId: target.projectId,
        projectName: target.projectName,
        environmentId: target.environmentId,
        environmentName: target.environment,
      },
    )
  }

  assertRailwayCliSupportsPinnedPlans(run(['--version']))
  const selected = parseRailwayLinkedTarget(run(['status']))
  assertRailwayTargetMatchesPlanEvidence(input.evidence, selected)
  assertProjectIsolation()
  const currentSources = assertReviewedCandidatePlan(
    runPlan(railwayPlanArgs({ iacFile: IAC_FILE })),
    input.evidence,
    candidate,
  )

  const plan = schemaMigratorPlan(input.manifest)
  const baselineDeploymentIds = new Set(
    parseDeploymentRows(run(deploymentListArgs(target)))
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string' && DEPLOYMENT_ID.test(id)),
  )
  const desired = stagedRailwayServiceSourceInput(currentSources, candidate, SERVICE)
  environment = {
    ...environment,
    [RAILWAY_SERVICE_SOURCE_MAP_ENV]: railwaySourceMapEnvironment(desired),
  }
  const planDirectory = mkdtempSync(join(tmpdir(), 'repkey-schema-iac-plan-'))
  const planPath = join(planDirectory, 'saved-plan.json')
  try {
    if (currentIacDigest() !== input.manifest.contract.iacSha256) {
      throw new Error('Railway IaC changed before schema-migrator saved planning')
    }
    assertProjectIsolation()
    const planned = runPlan(railwayPinnedPlanArgs(planPath, IAC_FILE))
    const savedPlanSha256 = bindRailwaySavedPlanArtifact(
      planPath,
      planned.stdout,
      railwayIacTarget(input.evidence),
      currentSources,
      desired,
      SERVICE,
    )
    const disposition = inspectStagedRailwayPlan(
      planned.stdout,
      railwayIacTarget(input.evidence),
      currentSources,
      desired,
      SERVICE,
    )
    if (
      (disposition === 'change' && planned.status !== 2) ||
      (disposition === 'noop' && planned.status !== 0)
    ) {
      throw new Error(
        `Railway schema-migrator saved-plan exit ${String(planned.status)} disagrees with ${disposition}`,
      )
    }
    if (currentIacDigest() !== input.manifest.contract.iacSha256) {
      throw new Error('Railway IaC changed between schema-migrator plan and apply')
    }
    assertProjectIsolation()
    if (disposition === 'change') {
      assertRailwaySavedPlanArtifactUnchanged(planPath, savedPlanSha256)
      assertPinnedRailwayApplyResult(run(railwayPinnedApplyArgs(planPath)), SERVICE)
    } else {
      assertRedeployFromSourceAcknowledged(
        run([
          'service',
          'redeploy',
          '--from-source',
          '--yes',
          '--service',
          plan.service,
          '--project',
          target.projectId,
          '--environment',
          target.environmentId,
          '--json',
        ]),
      )
    }
  } finally {
    rmSync(planDirectory, { recursive: true, force: true })
  }

  const deadline = now() + input.timeoutMs
  let deploymentId: string | undefined
  while (true) {
    const rows = parseDeploymentRows(run(deploymentListArgs(target)))
    const newRows = rows.filter(
      (candidate) =>
        typeof candidate.id === 'string' &&
        DEPLOYMENT_ID.test(candidate.id) &&
        !baselineDeploymentIds.has(candidate.id),
    )
    if (!deploymentId) {
      const exactDigestRows = newRows.filter(
        (candidate) => candidate.meta?.imageDigest === plan.imageDigest,
      )
      if (exactDigestRows.length > 1) {
        throw new Error(
          'multiple new schema-migrator deployments report the signed image digest; settlement is ambiguous',
        )
      }
      deploymentId = exactDigestRows[0]?.id
    }
    const row = deploymentId
      ? rows.find((candidate) => candidate.id === deploymentId)
      : undefined
    const status = row?.status ?? 'UNKNOWN'
    if (status === 'SUCCESS') {
      if (!deploymentId) {
        throw new Error('Railway reported SUCCESS without a deployment id')
      }
      const observedDigest = row?.meta?.imageDigest ?? ''
      if (observedDigest !== plan.imageDigest) {
        throw new Error(
          `schema-migrator deployment ${deploymentId} image digest ${observedDigest || '(unavailable)'} does not match signed ${plan.imageDigest}`,
        )
      }
      const converged = runPlan(railwayPlanArgs({ iacFile: IAC_FILE }))
      if (converged.status !== 0) {
        throw new Error('Railway schema-migrator graph still has drift after apply')
      }
      const finalDisposition = inspectStagedRailwayPlan(
        converged.stdout,
        railwayIacTarget(input.evidence),
        desired.sources,
        desired,
        SERVICE,
      )
      if (finalDisposition !== 'noop') {
        throw new Error('Railway schema-migrator source did not converge')
      }
      assertProjectIsolation()
      return { deploymentId, imageDigest: observedDigest, status: 'SUCCESS' }
    }
    if (status !== 'UNKNOWN' && !IN_PROGRESS_STATUSES.has(status)) {
      throw new Error(`schema-migrator deployment ${deploymentId} ended ${status}`)
    }
    if (now() > deadline) {
      throw new Error(
        `schema-migrator deployment ${deploymentId ?? '(not observed)'} remained ${status} after ${String(Math.round(input.timeoutMs / 1000))}s`,
      )
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

function harnessArgv(args: readonly string[]): string[] {
  const kept: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string
    const owned = OWN_VALUE_FLAGS.find(
      (flag) => token === flag || token.startsWith(`${flag}=`),
    )
    if (owned) {
      if (token === owned) index += 1
      continue
    }
    kept.push(token)
  }
  return kept
}

function printPlan(options: LoadedOptions): number {
  const plan = schemaMigratorPlan(options.manifest)
  out(
    `DRY RUN — ${options.evidence.deploymentProfile} ${options.evidence.target.projectName}/${options.evidence.target.environment}`,
  )
  out(
    `Reviewed target IDs: ${options.evidence.target.projectId}/${options.evidence.target.environmentId}`,
  )
  out(`Signed migration head: ${options.manifest.contract.migrationHead}`)
  out(`One-shot service: ${plan.service}`)
  out(`Signed web image: ${plan.imageReference}`)
  out(
    `Bootstrap authorization evidence: ${options.auditEvidencePath ?? '(required with --apply)'}`,
  )
  out(
    'Apply will verify Sigstore, prove single-environment project isolation, apply one saved IaC source plan, and require SUCCESS.',
  )
  out('No Railway command has been invoked.')
  out('Re-run with --apply --operator <id> --reason "<change record>" to execute.')
  return 0
}

export async function runBootstrapSchemaMigratorCli(
  args: readonly string[],
): Promise<number> {
  const parsed = parseOptions(args)
  if (typeof parsed === 'string') {
    process.stderr.write(`${parsed}\n`)
    return 2
  }
  const loaded = loadOptions(parsed)
  if (typeof loaded === 'string') {
    process.stderr.write(`invalid schema bootstrap contract:\n${loaded}\n`)
    return 1
  }
  if (!loaded.apply) return printPlan(loaded)

  const missing = ['--operator', '--reason', '--audit-evidence'].filter(
    (flag) => !flagValue(args, flag),
  )
  if (missing.length > 0) {
    process.stderr.write(
      `${COMMAND_NAME} --apply needs ${missing.join(' and ')} for the durable operator audit.\n`,
    )
    return 2
  }

  const verified = verifyManifestSignature(loaded)

  // Recompute after signature verification and immediately before loading
  // dynamic authorization code. A controller dependency changed after the
  // initial artifact load must never reach Railway or the operator harness.
  assertReleaseControllerSourceDigest(
    verified.manifest.contract.releaseControllerSha256,
    releaseControllerSourceDigest(),
  )

  // Bootstrap-safe audited path: migration 0140 may not exist yet, so this
  // first operation cannot write policy_decision_audit in the target database.
  // The existing pure operator harness still owns argument parsing, named
  // identity, reason, correlation and allow/deny semantics. Its decision is
  // durably recorded in a new, content-addressed, no-overwrite artifact before
  // any Railway command. Normal release:beta keeps the database-backed harness.
  const [{ runOperatorCommand }, { parseOperatorIdentities }] = await Promise.all([
    import('../../src/shared/ops/operator-command'),
    import('../../src/shared/auth/execution-policy'),
  ])
  const registeredOperators = parseOperatorIdentities(process.env)
  const auditEvidencePath = loaded.auditEvidencePath as string
  const plan = schemaMigratorPlan(verified.manifest)
  const result = await runOperatorCommand(
    {
      name: COMMAND_NAME,
      scope: 'global',
      mutation: true,
      usage: `pnpm ${COMMAND_NAME} --manifest <manifest.json> --signature-bundle <bundle.json> --manifest-sha256 <digest> --railway-plan-evidence <evidence.json> --railway-plan-evidence-sha256 <digest> --cell us --apply --operator <id> --reason "<change record>" --audit-evidence <new-json-path>`,
    },
    async () => {
      validateSchemaMigrationBootstrapContract(verified.manifest, loaded.evidence, {
        cell: loaded.cell,
        currentIacSha256: railwayIacSourceDigest(),
        currentReleaseControllerSha256: releaseControllerSourceDigest(),
        currentMigrationHead: currentMigrationHead(),
        now: new Date(),
      })
      const settled = await executeSignedSchemaMigrationBootstrap({
        manifest: verified.manifest,
        evidence: loaded.evidence,
        timeoutMs: loaded.timeoutMs,
      })
      out(
        `verified: ${SERVICE} deployment ${settled.deploymentId} exited SUCCESS at ${settled.imageDigest}`,
      )
      return 0
    },
    {
      decide: async (request) => {
        if (request.principal.kind !== 'operator') {
          throw new Error('bootstrap audit requires an operator principal')
        }
        if (!request.correlationId) {
          throw new Error('bootstrap audit requires a correlation id')
        }
        const allowed = registeredOperators.has(request.principal.id)
        const decision = {
          allowed,
          reason: allowed ? ('allowed' as const) : ('operator_not_registered' as const),
          action: request.action,
          policyVersion: 'schema-bootstrap-artifact-1',
        } as const
        const authorization = createSchemaMigrationBootstrapAuthorization({
          version: SCHEMA_MIGRATION_BOOTSTRAP_AUDIT_VERSION,
          evidenceKind: 'schema-migration-bootstrap-authorization',
          recordedAt: request.now.toISOString(),
          command: COMMAND_NAME,
          correlationId: request.correlationId,
          operator: request.principal.id,
          reason: request.reason ?? '',
          decision: {
            ...decision,
            action: 'system:ops',
          },
          cell: loaded.cell,
          deploymentProfile: loaded.evidence.deploymentProfile,
          target: loaded.evidence.target,
          release: {
            manifestSha256: loaded.manifestSha256,
            signatureBundleSha256: verified.signatureBundleSha256,
            railwayPlanEvidenceSha256: loaded.railwayPlanEvidenceSha256,
            iacSha256: verified.manifest.contract.iacSha256,
            releaseControllerSha256: verified.manifest.contract.releaseControllerSha256,
            migrationHead: verified.manifest.contract.migrationHead,
            imageReference: plan.imageReference,
            imageDigest: plan.imageDigest,
          },
        })
        const content = canonicalSchemaMigrationBootstrapAuthorization(authorization)
        const digest = writeBootstrapAuthorizationEvidence(auditEvidencePath, content)
        out(`bootstrap authorization evidence: ${auditEvidencePath} (${digest})`)
        return decision
      },
    },
    harnessArgv(args),
  )
  return result.exitCode
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await runBootstrapSchemaMigratorCli(process.argv.slice(2)).catch(
    (error: unknown) => {
      process.stderr.write(
        `${COMMAND_NAME} failed: ${error instanceof Error ? error.message : String(error)}\n`,
      )
      return 1
    },
  )
}
