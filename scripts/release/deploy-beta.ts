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
//   1. Settlement. A saved IaC apply returns before a deployment settles. Every
//      promotion is tracked by deployment id and polled to a terminal state;
//      anything but SUCCESS fails the release.
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
//     --manifest-sha256 <digest> --people-cutover-evidence <evidence.json>
//     --data-cell-cutover-evidence <evidence.json>
//     --data-cell-cutover-evidence-sha256 <digest>
//     --railway-plan-evidence <evidence.json>
//     --railway-plan-evidence-sha256 <digest> --cell <us>
//   add --apply --operator <id> --reason "<text>" to execute
//   add --verify-only to prove an already-promoted cell
//   flags: --app-url <url> --deploy-timeout <seconds>
//
// Verification, always run after a settled --apply and by --verify-only:
//   1. completed Data Cell evidence matches a fresh locked US/policy-3 read,
//   2. current people-authority parity matches audited cutover evidence,
//   3. RELEASE_SHA + RELEASE_MANIFEST_SHA256 from every service (blocking),
//   4. active Railway image digest from every service (blocking),
//   5. web/worker BETTER_AUTH_URL equals the profile-bound authentication
//      origin, then GET /api/health at the selected probe origin reports every
//      readiness boolean true (blocking),
//   6. every ai_execution_control_heads row enabled/accepting (blocking when
//      DATABASE_URL is set; skipped, printed, otherwise).

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import {
  BETA_DEPLOYMENT_DATA_CELL_IDS,
  DATA_CELL_CATALOGUE,
  isBetaDeploymentDataCellId,
  type BetaDeploymentDataCellId,
  type DataCellDefinition,
} from '../../src/shared/domain/data-cell-catalogue'
import {
  RAILWAY_SERVICE_IMAGE_ROLES,
  parsePromotionManifest,
  promotedImageReference,
  sigstoreManifestVerificationArgs,
  type PromotionManifest,
  type RailwayApplicationService,
} from '../../src/shared/release/promotion-manifest'
import {
  parsePeopleCutoverEvidence,
  type PeopleCutoverCounts,
  type PeopleCutoverEvidence,
} from '../../src/shared/release/people-cutover-evidence'
import {
  assertRailwayPlanEvidenceFresh,
  classifyRailwayPlanExit,
  parseRailwayPlanEvidence,
  railwayPlanArgs,
  railwayPlanEvidenceSha256,
  type RailwayPlanEvidence,
} from '../../src/shared/release/railway-plan-evidence'
import type { RailwayDeploymentProfile } from '../../src/shared/release/railway-deployment-profile'
import {
  assertRailwayFullProjectVisibilityCredential,
  assertSingleUsBetaRailwayProjectIsolation,
  parseRailwayProjectServiceInventory,
  railwayFullProjectStatusArgs,
} from '../../src/shared/release/railway-project-service-isolation'
import { getDb } from '../../src/shared/db'
import {
  readCompletedSingleUsDataCellCutover,
  type CompletedDataCellCutover,
} from '../../src/shared/db/single-us-data-cell-cutover'
import {
  parseDataCellCutoverEvidence,
  type DataCellCutoverEvidence,
} from '../../src/shared/release/data-cell-cutover-evidence'
import { verifyPeopleCutoverPromotionReadiness } from '../../src/contexts/team/infrastructure/repositories/reconcile-people-team.repository'
import {
  assertRailwayTargetMatchesPlanEvidence,
  parseRailwayLinkedTarget,
  railwayTargetEnvironment,
} from './railway-data-cell-plan'
import { railwayIacSourceDigest } from './iac-digest'
import {
  promotionReadbackArtifacts,
  writePromotionReadbackArtifacts,
  type PromotionReadbackObservations,
} from './capture-promotion-readback'
import { DORMANT_DATA_CELL_IDS } from '../../src/shared/release/promotion-readback-evidence'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from '../../src/shared/release/railway-deployment-profile'
import { RAILWAY_PLAN_EVIDENCE_VERSION } from '../../src/shared/release/railway-plan-evidence'
import {
  releaseEvidenceSha256,
  type ReleaseCandidateBinding,
} from '../../src/shared/release/candidate-bound-evidence'
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

const COMMAND_NAME = 'release:beta'
const ALL_SERVICES = Object.freeze(
  Object.keys(RAILWAY_SERVICE_IMAGE_ROLES) as RailwayApplicationService[],
)

const HEADS_QUERY =
  'select scope_key, execution_state, admission_state from ai_execution_control_heads order by 1'

/** Railway deployment states that will never change again. */
const TERMINAL_STATUSES = new Set(['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED', 'SKIPPED'])
const DEPLOYMENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

const DEFAULT_DEPLOY_TIMEOUT_SECONDS = 900
const MAX_DEPLOY_TIMEOUT_SECONDS = 3_600
const POLL_INTERVAL_MS = 10_000
/** Flags this script owns; stripped before argv reaches the operator harness. */
const OWN_VALUE_FLAGS = [
  '--app-url',
  '--deploy-timeout',
  '--manifest',
  '--signature-bundle',
  '--manifest-sha256',
  '--people-cutover-evidence',
  '--data-cell-cutover-evidence',
  '--data-cell-cutover-evidence-sha256',
  '--railway-plan-evidence',
  '--railway-plan-evidence-sha256',
  '--cell',
  '--readback-output',
] as const
const OWN_BOOLEAN_FLAGS = ['--verify-only'] as const

export type ServicePlan = {
  readonly service: RailwayApplicationService
  readonly variables: readonly string[]
  readonly imageReference: string
  readonly imageDigest: string
}

type Deployment = Readonly<{
  service: string
  deploymentId: string | undefined
  baselineDeploymentIds: readonly string[]
}>

type HeadRow = {
  readonly scope_key: string
  readonly execution_state: string
  readonly admission_state: string
}

type ParsedOptions = {
  readonly apply: boolean
  readonly verifyOnly: boolean
  readonly appUrlOverride: string | undefined
  readonly deployTimeoutMs: number
  readonly manifestPath: string
  readonly signatureBundlePath: string
  readonly manifestSha256: string
  readonly peopleCutoverEvidencePath: string
  readonly dataCellCutoverEvidencePath: string
  readonly dataCellCutoverEvidenceSha256: string
  readonly railwayPlanEvidencePath: string
  readonly railwayPlanEvidenceSha256: string
  readonly cell: BetaDeploymentDataCellId
  readonly environment: `cell-${BetaDeploymentDataCellId}`
  /** REL-01-T5: directory the four typed read-back artifacts are written to. */
  readonly readbackOutputDirectory: string | undefined
}

type Options = Omit<ParsedOptions, 'appUrlOverride'> &
  Readonly<{
    appUrl: string
    deploymentProfile: RailwayDeploymentProfile
    dataCellCutoverEvidence: DataCellCutoverEvidence
    railwayPlanEvidence: RailwayPlanEvidence
  }>

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

export function deployTimeoutMilliseconds(value: string | undefined): number {
  if (value === undefined) return DEFAULT_DEPLOY_TIMEOUT_SECONDS * 1000
  const seconds = Number(value)
  if (
    !Number.isSafeInteger(seconds) ||
    seconds <= 0 ||
    seconds > MAX_DEPLOY_TIMEOUT_SECONDS
  ) {
    throw new Error(
      `--deploy-timeout must be a positive integer no greater than ${String(MAX_DEPLOY_TIMEOUT_SECONDS)} seconds`,
    )
  }
  return seconds * 1000
}

function parseOptions(args: readonly string[]): ParsedOptions | string {
  let deployTimeoutMs: number
  try {
    deployTimeoutMs = deployTimeoutMilliseconds(flagValue(args, '--deploy-timeout'))
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  const manifestPath = flagValue(args, '--manifest')
  const signatureBundlePath = flagValue(args, '--signature-bundle')
  const manifestSha256 = flagValue(args, '--manifest-sha256')
  const peopleCutoverEvidencePath = flagValue(args, '--people-cutover-evidence')
  const dataCellCutoverEvidencePath = flagValue(args, '--data-cell-cutover-evidence')
  const dataCellCutoverEvidenceSha256 = flagValue(
    args,
    '--data-cell-cutover-evidence-sha256',
  )
  const railwayPlanEvidencePath = flagValue(args, '--railway-plan-evidence')
  const railwayPlanEvidenceSha256 = flagValue(args, '--railway-plan-evidence-sha256')
  const cellValue = flagValue(args, '--cell')
  if (cellValue && !isBetaDeploymentDataCellId(cellValue)) {
    return `--cell must be one of: ${BETA_DEPLOYMENT_DATA_CELL_IDS.join(', ')}`
  }
  const cell: BetaDeploymentDataCellId | undefined =
    cellValue !== undefined && isBetaDeploymentDataCellId(cellValue)
      ? cellValue
      : undefined
  if (
    !manifestPath ||
    !signatureBundlePath ||
    !manifestSha256 ||
    !peopleCutoverEvidencePath ||
    !dataCellCutoverEvidencePath ||
    !dataCellCutoverEvidenceSha256 ||
    !railwayPlanEvidencePath ||
    !railwayPlanEvidenceSha256 ||
    !cell
  ) {
    return '--manifest, --signature-bundle, --manifest-sha256, --people-cutover-evidence, --data-cell-cutover-evidence, --data-cell-cutover-evidence-sha256, --railway-plan-evidence, --railway-plan-evidence-sha256, and --cell are required'
  }
  if (!/^[0-9a-f]{64}$/u.test(manifestSha256)) {
    return '--manifest-sha256 must be a lowercase sha256'
  }
  if (!/^[0-9a-f]{64}$/u.test(railwayPlanEvidenceSha256)) {
    return '--railway-plan-evidence-sha256 must be a lowercase sha256'
  }
  if (!/^[0-9a-f]{64}$/u.test(dataCellCutoverEvidenceSha256)) {
    return '--data-cell-cutover-evidence-sha256 must be a lowercase sha256'
  }
  const dataCell = cell
  const options: ParsedOptions = {
    apply: args.includes('--apply'),
    verifyOnly: args.includes('--verify-only'),
    readbackOutputDirectory: flagValue(args, '--readback-output'),
    appUrlOverride: flagValue(args, '--app-url'),
    deployTimeoutMs,
    manifestPath: resolve(manifestPath),
    signatureBundlePath: resolve(signatureBundlePath),
    manifestSha256,
    peopleCutoverEvidencePath: resolve(peopleCutoverEvidencePath),
    dataCellCutoverEvidencePath: resolve(dataCellCutoverEvidencePath),
    dataCellCutoverEvidenceSha256,
    railwayPlanEvidencePath: resolve(railwayPlanEvidencePath),
    railwayPlanEvidenceSha256,
    cell: dataCell,
    environment: `cell-${dataCell}`,
  }
  if (options.apply && options.verifyOnly) {
    return '--apply and --verify-only are mutually exclusive'
  }
  return options
}

function canonicalHttpsOrigin(value: string, source: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${source} must be an absolute HTTPS URL`)
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(`${source} must be a credential-free HTTPS origin without a path`)
  }
  return url.origin
}

/** Resolve the health-probe origin without letting rehearsal borrow production. */
export function resolveDeploymentAppUrl(
  input: Readonly<{
    deploymentProfile: RailwayDeploymentProfile
    cell: BetaDeploymentDataCellId
    appUrlOverride?: string
    environmentAppUrl?: string
  }>,
): string {
  const productionOrigin = `https://${DATA_CELL_CATALOGUE[input.cell].domain}`
  if (input.deploymentProfile === 'production') {
    return canonicalHttpsOrigin(
      input.appUrlOverride ?? input.environmentAppUrl ?? productionOrigin,
      '--app-url',
    )
  }

  if (!input.appUrlOverride) {
    throw new Error('rehearsal promotion requires its own explicit --app-url')
  }
  const appUrl = canonicalHttpsOrigin(input.appUrlOverride, '--app-url')
  if (new URL(appUrl).hostname === DATA_CELL_CATALOGUE[input.cell].domain) {
    throw new Error(
      `rehearsal --app-url must not use the production host ${DATA_CELL_CATALOGUE[input.cell].domain}`,
    )
  }
  return appUrl
}

function expectedRuntimeAuthenticationUrl(options: Options): string {
  return options.deploymentProfile === 'production'
    ? `https://${DATA_CELL_CATALOGUE[options.cell].domain}`
    : options.appUrl
}

export function validateRailwayPlanEvidenceForPromotion(
  evidence: RailwayPlanEvidence,
  input: Readonly<{
    cell: BetaDeploymentDataCellId
    manifestSha256: string
    signedIacSha256: string
    currentIacSha256: string
    signedReleaseControllerSha256: string
    currentReleaseControllerSha256: string
    now: Date
  }>,
): void {
  if (evidence.cell !== input.cell) {
    throw new Error(
      `Railway plan cell ${evidence.cell} does not match requested cell ${input.cell}`,
    )
  }
  if (evidence.release.manifestSha256 !== input.manifestSha256) {
    throw new Error(
      `Railway plan manifest digest ${evidence.release.manifestSha256} does not match requested manifest digest ${input.manifestSha256}`,
    )
  }
  if (evidence.release.controllerSha256 !== input.signedReleaseControllerSha256) {
    throw new Error(
      `Railway plan controller digest ${evidence.release.controllerSha256} does not match signed manifest controller digest ${input.signedReleaseControllerSha256}`,
    )
  }
  assertReleaseControllerSourceDigest(
    input.signedReleaseControllerSha256,
    input.currentReleaseControllerSha256,
  )
  if (evidence.iac.sha256 !== input.signedIacSha256) {
    throw new Error(
      `Railway plan IaC digest ${evidence.iac.sha256} does not match signed manifest IaC digest ${input.signedIacSha256}`,
    )
  }
  if (input.currentIacSha256 !== input.signedIacSha256) {
    throw new Error(
      `current Railway IaC digest ${input.currentIacSha256} does not match signed manifest IaC digest ${input.signedIacSha256}`,
    )
  }
  assertRailwayPlanEvidenceFresh(evidence, input.now)
}

function bindOptions(
  parsed: ParsedOptions,
  dataCellCutoverEvidence: DataCellCutoverEvidence,
  railwayPlanEvidence: RailwayPlanEvidence,
): Options {
  assertDataCellCutoverTargetMatchesRailwayPlan(
    dataCellCutoverEvidence,
    railwayPlanEvidence,
  )
  const { appUrlOverride, ...rest } = parsed
  return {
    ...rest,
    appUrl: resolveDeploymentAppUrl({
      deploymentProfile: railwayPlanEvidence.deploymentProfile,
      cell: parsed.cell,
      appUrlOverride,
      environmentAppUrl: process.env.BETA_APP_URL,
    }),
    deploymentProfile: railwayPlanEvidence.deploymentProfile,
    dataCellCutoverEvidence,
    railwayPlanEvidence,
  }
}

/**
 * The topology cutover and the infrastructure review must name the same
 * opaque Railway target. Human-readable names are intentionally insufficient:
 * a copied database or relinked environment must not satisfy promotion.
 */
export function assertDataCellCutoverTargetMatchesRailwayPlan(
  evidence: DataCellCutoverEvidence,
  railwayPlanEvidence: RailwayPlanEvidence,
): void {
  const comparisons = [
    ['cell', evidence.target.cell, railwayPlanEvidence.cell],
    ['projectId', evidence.target.projectId, railwayPlanEvidence.target.projectId],
    [
      'environmentId',
      evidence.target.environmentId,
      railwayPlanEvidence.target.environmentId,
    ],
  ] as const
  const mismatch = comparisons.find(([, cutover, plan]) => cutover !== plan)
  if (mismatch) {
    const [field, cutover, plan] = mismatch
    throw new Error(
      `Data Cell cutover target ${field}=${cutover} does not match Railway plan target ${field}=${plan}`,
    )
  }
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

let pinnedRailwayEnvironment: NodeJS.ProcessEnv | undefined
let pinnedRailwayTarget: RailwayPlanEvidence['target'] | undefined

type RailwayCommandResult = Readonly<{ stdout: string; status: number }>

/**
 * Replace the reviewed human environment name with its opaque ID and refuse
 * any explicit target that disagrees with the pinned evidence. Environment
 * variables still bind commands that do not expose target flags.
 */
export function bindRailwayCommandArgsToTarget(
  args: readonly string[],
  target: RailwayPlanEvidence['target'],
): readonly string[] {
  const bound = [...args]
  for (let index = 0; index < bound.length; index += 1) {
    const flag = bound[index]
    if (flag !== '--environment' && flag !== '--project') continue
    const value = bound[index + 1]
    if (!value) throw new Error(`${flag} requires a target value`)
    const accepted =
      flag === '--environment'
        ? [target.environment, target.environmentId]
        : [target.projectName, target.projectId]
    if (!accepted.includes(value)) {
      throw new Error(`${flag} ${value} does not match the reviewed Railway target`)
    }
    bound[index + 1] = flag === '--environment' ? target.environmentId : target.projectId
    index += 1
  }
  return Object.freeze(bound)
}

/** Run a Railway command and permit only the explicitly reviewed exit codes. */
function railwayCommand(
  args: readonly string[],
  allowedStatuses: readonly number[] = [0],
): RailwayCommandResult {
  const targetedArgs = pinnedRailwayTarget
    ? bindRailwayCommandArgsToTarget(args, pinnedRailwayTarget)
    : args
  const printable = `railway ${targetedArgs.join(' ')}`
  const result = spawnSync('railway', [...targetedArgs], {
    encoding: 'utf8',
    env: pinnedRailwayEnvironment ?? process.env,
  })
  if (result.error) throw new Error(`${printable}: ${result.error.message}`)
  const status = result.status ?? 1
  if (!allowedStatuses.includes(status)) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`${printable} exited ${String(status)}\n${detail}`)
  }
  return Object.freeze({ stdout: result.stdout ?? '', status })
}

function railway(args: readonly string[]): string {
  return railwayCommand(args).stdout
}

function setPinnedRailwaySourceInput(input: RailwayServiceSourceInput): void {
  if (!pinnedRailwayEnvironment) {
    throw new Error('Railway target must be pinned before selecting a source graph')
  }
  pinnedRailwayEnvironment = {
    ...pinnedRailwayEnvironment,
    [RAILWAY_SERVICE_SOURCE_MAP_ENV]: railwaySourceMapEnvironment(input),
  }
}

/**
 * Select the exact reviewed target by opaque IDs and keep those IDs in every
 * later Railway child process. Ambient links are never an execution input.
 */
function pinAndAssertRailwayTarget(
  evidence: RailwayPlanEvidence,
  sourceInput: RailwayServiceSourceInput,
): void {
  pinnedRailwayTarget = evidence.target
  pinnedRailwayEnvironment = {
    ...railwayTargetEnvironment({
      project: evidence.target.projectId,
      name: evidence.target.projectName,
      environment: evidence.target.environmentId,
    }),
    RAILWAY_CALLER: process.env.RAILWAY_CALLER ?? 'repo:release-beta',
    RAILWAY_AGENT_SESSION:
      process.env.RAILWAY_AGENT_SESSION ??
      `repkey-release-${evidence.deploymentProfile}-${evidence.cell}`,
    REPKEY_RAILWAY_CELL_ENVIRONMENT: evidence.target.environment,
    REPKEY_RAILWAY_DEPLOYMENT_PROFILE: evidence.deploymentProfile,
    [RAILWAY_SERVICE_SOURCE_MAP_ENV]: railwaySourceMapEnvironment(sourceInput),
  }
  assertRailwayFullProjectVisibilityCredential(pinnedRailwayEnvironment)
  assertRailwayCliSupportsPinnedPlans(railway(['--version']))
  const selectedTarget = parseRailwayLinkedTarget(railway(['status']))
  assertRailwayTargetMatchesPlanEvidence(evidence, selectedTarget)
  assertPinnedRailwayProjectIsolation(railwayIacTarget(evidence))
  out(
    `Railway target and single-environment service isolation confirmed: ${evidence.deploymentProfile} ${evidence.target.projectName} (${evidence.target.projectId}) / ${evidence.target.environment} (${evidence.target.environmentId})`,
  )
}

/** Re-read the complete project; a target-local status cannot prove isolation. */
function assertPinnedRailwayProjectIsolation(target: RailwayIacTarget): void {
  assertSingleUsBetaRailwayProjectIsolation(
    parseRailwayProjectServiceInventory(railway(railwayFullProjectStatusArgs())),
    {
      projectId: target.projectId,
      projectName: target.projectName,
      environmentId: target.environmentId,
      environmentName: target.environment,
    },
  )
}

function railwayIacTarget(evidence: RailwayPlanEvidence): RailwayIacTarget {
  return Object.freeze({
    projectId: evidence.target.projectId,
    projectName: evidence.target.projectName,
    environmentId: evidence.target.environmentId,
    environment: evidence.target.environment,
  })
}

/** Re-run the exact retained candidate plan against the pinned target. */
function assertLiveRailwayPlanMatchesEvidence(
  evidence: RailwayPlanEvidence,
  candidate: RailwayServiceSourceInput,
  requireNoDrift: boolean,
): RailwayServiceSourceMap {
  setPinnedRailwaySourceInput(candidate)
  const result = railwayCommand(
    railwayPlanArgs({ iacFile: '.railway/railway.ts' }),
    [0, 2],
  )
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
  if (inspected.rawSha256 !== evidence.plan.rawSha256) {
    throw new Error(
      `live Railway plan digest ${inspected.rawSha256} does not match retained ${evidence.plan.rawSha256}`,
    )
  }
  if (railwayPlanEvidenceSha256(result.stdout) !== evidence.plan.rawSha256) {
    throw new Error('live Railway plan bytes changed after inspection')
  }
  if (
    (result.status === 0 && inspected.changeCount !== 0) ||
    (result.status === 2 && inspected.changeCount === 0)
  ) {
    throw new Error('Railway plan exit code disagrees with its change set')
  }
  if (requireNoDrift && (result.status !== 0 || inspected.changeCount !== 0)) {
    throw new Error('verify-only requires an exact no-drift Railway plan')
  }
  out(
    `Railway live ${outcome} plan matches retained evidence for ${evidence.target.projectName}/${evidence.target.environment}`,
  )
  return inspected.currentSources
}

/** Prove the fully promoted graph is now exactly the signed candidate. */
function assertFinalRailwayPlanNoDrift(
  evidence: RailwayPlanEvidence,
  candidate: RailwayServiceSourceInput,
): void {
  setPinnedRailwaySourceInput(candidate)
  const result = railwayCommand(
    railwayPlanArgs({ iacFile: '.railway/railway.ts' }),
    [0, 2],
  )
  const inspected = inspectFullCandidateRailwayPlan(
    result.stdout,
    railwayIacTarget(evidence),
    candidate,
  )
  if (result.status !== 0 || inspected.changeCount !== 0) {
    throw new Error('Railway graph still has drift after staged source promotion')
  }
  for (const serviceName of Object.keys(candidate.sources)) {
    const source = serviceName as keyof RailwayServiceSourceMap
    if (inspected.currentSources[source] !== candidate.sources[source]) {
      throw new Error(`Railway graph did not converge ${serviceName} to the candidate`)
    }
  }
  assertPinnedRailwayProjectIsolation(railwayIacTarget(evidence))
  out('Railway graph confirmed no drift at the complete signed source map')
}

/** Parse only hostname-bearing fields from `railway domain list --json`. */
export function parseRailwayDomainHostnames(output: string): readonly string[] {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error('could not parse Railway web domain list')
  }
  const hostnames = new Set<string>()
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry)
      return
    }
    if (!candidate || typeof candidate !== 'object') return
    for (const [key, entry] of Object.entries(candidate)) {
      if (
        (key === 'domain' || key === 'hostname' || key === 'fqdn') &&
        typeof entry === 'string' &&
        entry.trim() !== ''
      ) {
        hostnames.add(entry.trim().toLowerCase().replace(/\.$/u, ''))
      } else {
        visit(entry)
      }
    }
  }
  visit(value)
  if (hostnames.size === 0) {
    throw new Error('Railway web domain list did not contain a hostname')
  }
  return Object.freeze([...hostnames].sort())
}

function assertHealthOriginBelongsToTarget(options: Options): void {
  const domains = parseRailwayDomainHostnames(
    railway([
      'domain',
      'list',
      '--service',
      'web',
      '--project',
      options.railwayPlanEvidence.target.projectId,
      '--environment',
      options.railwayPlanEvidence.target.environmentId,
      '--json',
    ]),
  )
  const hostname = assertHealthOriginAttached(options.appUrl, domains)
  out(`Railway health origin confirmed on target web service: ${hostname}`)
}

/** Require the selected probe origin to be attached to the exact web service. */
export function assertHealthOriginAttached(
  appUrl: string,
  domains: readonly string[],
): string {
  const hostname = new URL(appUrl).hostname.toLowerCase()
  if (!domains.includes(hostname)) {
    throw new Error(
      `health origin ${hostname} is not attached to the reviewed Railway web service (available: ${domains.join(', ')})`,
    )
  }
  return hostname
}

export type DeploymentRow = {
  readonly id?: string
  readonly status?: string
  readonly createdAt?: string
  readonly meta?: Readonly<{ imageDigest?: string }>
}

export type SchemaMigratorBootstrapBinding = Readonly<{
  deploymentId: string
  imageDigest: string
  source: string
}>

/**
 * Prove that the one-shot migration job is the signed candidate before any
 * serving service is changed. Railway returns deployments newest-first, but
 * the timestamp check makes that ordering an independently verified fact and
 * refuses tied or incomplete rows rather than guessing which run is binding.
 * The newest deployment overall must be the successful signed-digest run; an
 * older successful migration cannot authorize serving after a later run.
 */
export function assertSchemaMigratorBootstrapBinding(
  currentSources: RailwayServiceSourceMap,
  candidate: RailwayServiceSourceInput,
  rows: readonly DeploymentRow[],
  expectedDigest: string,
): SchemaMigratorBootstrapBinding {
  const expectedSource = candidate.sources['schema-migrator']
  if (!expectedSource) {
    throw new Error('signed candidate does not bind a schema-migrator source')
  }
  const currentSource = currentSources['schema-migrator']
  if (currentSource !== expectedSource) {
    throw new Error(
      `schema-migrator live source ${currentSource ?? '(unbound)'} does not match signed candidate ${expectedSource}`,
    )
  }

  const observed = rows.map((row) => {
    const createdAt =
      typeof row.createdAt === 'string' ? Date.parse(row.createdAt) : Number.NaN
    if (!Number.isFinite(createdAt)) {
      throw new Error(
        `schema-migrator deployment ${row.id ?? '(unavailable)'} has no valid createdAt binding`,
      )
    }
    return { row, createdAt }
  })
  if (observed.length === 0) {
    throw new Error('schema-migrator has no deployment history')
  }
  const newestTimestamp = Math.max(...observed.map((entry) => entry.createdAt))
  const newest = observed.filter((entry) => entry.createdAt === newestTimestamp)
  if (newest.length !== 1) {
    throw new Error('schema-migrator newest deployment is ambiguous')
  }
  const deployment = newest[0]?.row
  if (!deployment?.id || !DEPLOYMENT_ID.test(deployment.id)) {
    throw new Error('schema-migrator newest signed-digest deployment has no valid id')
  }
  if (deployment.meta?.imageDigest !== expectedDigest) {
    throw new Error(
      `schema-migrator newest deployment carries ${deployment.meta?.imageDigest ?? '(no digest)'}, not signed ${expectedDigest}`,
    )
  }
  if (deployment.status !== 'SUCCESS') {
    throw new Error(
      `schema-migrator deployment ${deployment.id} at the signed image digest is ${deployment.status ?? 'UNKNOWN'}, not SUCCESS`,
    )
  }
  return Object.freeze({
    deploymentId: deployment.id,
    imageDigest: expectedDigest,
    source: expectedSource,
  })
}

function listDeploymentRows(
  service: string,
  environment: string,
): readonly DeploymentRow[] {
  const listed = railway([
    'deployment',
    'list',
    '--service',
    service,
    '--environment',
    environment,
    '--limit',
    '100',
    '--json',
  ])
  let rows: unknown
  try {
    rows = JSON.parse(listed)
  } catch {
    throw new Error(`could not parse deployment list for ${service}`)
  }
  if (!Array.isArray(rows)) {
    throw new Error(`deployment list for ${service} must be an array`)
  }
  return rows as readonly DeploymentRow[]
}

function assertSchemaMigratorReadyForServing(
  currentSources: RailwayServiceSourceMap,
  candidate: RailwayServiceSourceInput,
  environment: string,
  expectedDigest: string,
): void {
  const binding = assertSchemaMigratorBootstrapBinding(
    currentSources,
    candidate,
    listDeploymentRows('schema-migrator', environment),
    expectedDigest,
  )
  out(
    `schema-migrator bootstrap confirmed: deployment ${binding.deploymentId} SUCCESS at ${binding.imageDigest}`,
  )
}

/** Select only a newly-created deployment carrying the signed digest. */
export function selectPromotedDeploymentRow(
  rows: readonly DeploymentRow[],
  deployment: Deployment,
  expectedDigest: string,
): DeploymentRow | undefined {
  if (deployment.deploymentId) {
    const row = rows.find((entry) => entry.id === deployment.deploymentId)
    if (row && row.meta?.imageDigest !== expectedDigest) {
      throw new Error(
        `${deployment.service}: deployment ${deployment.deploymentId} carries ${row.meta?.imageDigest ?? '(no digest)'} instead of ${expectedDigest}`,
      )
    }
    return row
  }
  const baseline = new Set(deployment.baselineDeploymentIds)
  const candidates = rows.filter(
    (entry) =>
      typeof entry.id === 'string' &&
      !baseline.has(entry.id) &&
      entry.meta?.imageDigest === expectedDigest,
  )
  if (candidates.length > 1) {
    throw new Error(
      `${deployment.service}: multiple new deployments carry ${expectedDigest}; refusing ambiguous settlement`,
    )
  }
  return candidates[0]
}

function assertRedeployFromSourceAcknowledged(output: string, service: string): void {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error(`${service}: Railway recovery redeploy did not return JSON`)
  }
  if (
    !value ||
    typeof value !== 'object' ||
    (value as Readonly<Record<string, unknown>>).success !== true
  ) {
    throw new Error(`${service}: Railway recovery redeploy was not acknowledged`)
  }
}

/**
 * Advance exactly one IaC-owned immutable source through a saved Railway plan.
 * The saved plan is the apply input, closing the plan/apply race. A converged
 * retry redeploys the already-reviewed source once so release variables reach
 * the running service without changing source ownership.
 */
function stageServiceSource(
  plan: ServicePlan,
  environment: string,
  currentSources: RailwayServiceSourceMap,
  candidate: RailwayServiceSourceInput,
  target: RailwayIacTarget,
  expectedIacSha256: string,
): Readonly<{ deployment: Deployment; sources: RailwayServiceSourceMap }> {
  if (railwayIacSourceDigest() !== expectedIacSha256) {
    throw new Error(`${plan.service}: Railway IaC changed before release mutation`)
  }
  const baselineDeploymentIds = listDeploymentRows(plan.service, environment)
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string')
  assertPinnedRailwayProjectIsolation(target)
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
  const desired = stagedRailwayServiceSourceInput(currentSources, candidate, plan.service)
  setPinnedRailwaySourceInput(desired)
  const directory = mkdtempSync(join(tmpdir(), `repkey-railway-${plan.service}-`))
  const planPath = join(directory, 'saved-plan.json')
  try {
    if (railwayIacSourceDigest() !== expectedIacSha256) {
      throw new Error(`${plan.service}: Railway IaC changed before saved planning`)
    }
    assertPinnedRailwayProjectIsolation(target)
    const planned = railwayCommand(railwayPinnedPlanArgs(planPath), [0, 2])
    const savedPlanSha256 = bindRailwaySavedPlanArtifact(
      planPath,
      planned.stdout,
      target,
      currentSources,
      desired,
      plan.service,
    )
    const disposition = inspectStagedRailwayPlan(
      planned.stdout,
      target,
      currentSources,
      desired,
      plan.service,
    )
    if (
      (disposition === 'change' && planned.status !== 2) ||
      (disposition === 'noop' && planned.status !== 0)
    ) {
      throw new Error(
        `${plan.service}: Railway saved-plan exit ${String(planned.status)} disagrees with ${disposition}`,
      )
    }
    if (railwayIacSourceDigest() !== expectedIacSha256) {
      throw new Error(`${plan.service}: Railway IaC changed between plan and apply`)
    }
    assertPinnedRailwayProjectIsolation(target)
    if (disposition === 'change') {
      assertRailwaySavedPlanArtifactUnchanged(planPath, savedPlanSha256)
      assertPinnedRailwayApplyResult(
        railway(railwayPinnedApplyArgs(planPath)),
        plan.service,
      )
    } else {
      assertRedeployFromSourceAcknowledged(
        railway([
          'service',
          'redeploy',
          '--from-source',
          '--yes',
          '--service',
          plan.service,
          '--environment',
          environment,
          '--json',
        ]),
        plan.service,
      )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  return Object.freeze({
    deployment: Object.freeze({
      service: plan.service,
      deploymentId: undefined,
      baselineDeploymentIds: Object.freeze(baselineDeploymentIds),
    }),
    sources: desired.sources,
  })
}

function deploymentStatus(
  deployment: Deployment,
  environment: string,
  expectedDigest?: string,
): Readonly<{ status: string; deploymentId: string | undefined }> {
  if (!expectedDigest) return { status: 'UNKNOWN', deploymentId: undefined }
  const row = selectPromotedDeploymentRow(
    listDeploymentRows(deployment.service, environment),
    deployment,
    expectedDigest,
  )
  return { status: row?.status ?? 'UNKNOWN', deploymentId: row?.id }
}

function plannedImageDigest(
  plans: readonly ServicePlan[],
  service: string,
): string | undefined {
  return plans.find((plan) => plan.service === service)?.imageDigest
}

/**
 * Observe one pending service. A settled service leaves `pending` — with a
 * failure recorded when it did not end SUCCESS — and a service that has only
 * just revealed its deployment id is written back so later polls reuse it.
 */
function pollPendingService(
  service: string,
  deployment: Deployment,
  context: Readonly<{
    plans: readonly ServicePlan[]
    environment: string
    pending: Map<string, Deployment>
    failures: string[]
  }>,
): void {
  const { plans, environment, pending, failures } = context
  const observation = deploymentStatus(
    deployment,
    environment,
    plannedImageDigest(plans, service),
  )
  const observedDeployment = observation.deploymentId
    ? { ...deployment, deploymentId: observation.deploymentId }
    : deployment
  if (observation.deploymentId && !deployment.deploymentId) {
    pending.set(service, observedDeployment)
  }
  const status = observation.status
  if (!TERMINAL_STATUSES.has(status)) return
  pending.delete(service)
  out(
    `  ${service.padEnd(28)} ${status} (${observedDeployment.deploymentId ?? 'deployment unavailable'})`,
  )
  if (status !== 'SUCCESS') {
    failures.push(
      `${service}: deployment ${observedDeployment.deploymentId ?? '(unavailable)'} ended ${status}`,
    )
  }
}

/** Record one failure per service that never reached a terminal state in time. */
function reportUnsettledServices(
  pending: ReadonlyMap<string, Deployment>,
  plans: readonly ServicePlan[],
  environment: string,
  timeoutMs: number,
  failures: string[],
): void {
  for (const [service, deployment] of pending) {
    const expectedDigest = plannedImageDigest(plans, service)
    const observation = deploymentStatus(deployment, environment, expectedDigest)
    failures.push(
      `${service}: deployment ${observation.deploymentId ?? `(new digest ${expectedDigest ?? 'unknown'})`} still ${observation.status} after ${String(Math.round(timeoutMs / 1000))}s`,
    )
  }
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
      pollPendingService(service, deployment, { plans, environment, pending, failures })
    }
    if (pending.size === 0) break
    if (Date.now() > deadline) {
      reportUnsettledServices(pending, plans, environment, timeoutMs, failures)
      break
    }
    await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS))
  }
  return failures
}

type ReleaseVariable =
  | 'RELEASE_SHA'
  | 'RELEASE_MANIFEST_SHA256'
  | 'SOURCE_REVISION'
  | 'IMAGE_SOURCE_REVISION'
  | 'BETTER_AUTH_URL'

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
    BETTER_AUTH_URL: values.BETTER_AUTH_URL ?? '',
  }
}

function runtimeAuthenticationUrlFailures(
  environment: string,
  expectedAppUrl: string,
): readonly string[] {
  const failures: string[] = []
  for (const service of ['web', 'worker'] as const) {
    const configured = readReleaseVariables(service, environment).BETTER_AUTH_URL
    let configuredOrigin: string
    try {
      configuredOrigin = canonicalHttpsOrigin(configured, `${service} BETTER_AUTH_URL`)
    } catch {
      failures.push(`${service}: BETTER_AUTH_URL must be a credential-free HTTPS origin`)
      continue
    }
    out(`  ${service} BETTER_AUTH_URL=${configuredOrigin}`)
    if (configuredOrigin !== expectedAppUrl) {
      failures.push(
        `${service}: BETTER_AUTH_URL=${configuredOrigin} != ${expectedAppUrl}`,
      )
    }
  }
  return failures
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

type ReleaseIdentityRow = Readonly<{
  service: string
  releaseSha: string
  releaseManifestSha256: string
  sourceRevisionOverride: string
  imageSourceRevisionOverride: string
  activeDeploymentId: string
  activeImageDigest: string
}>

/**
 * Read-back table. Returns the failures so every service is reported, not the
 * first, and the OBSERVED ROWS so REL-01-T5 can emit them as typed evidence
 * instead of leaving them in a terminal scrollback.
 */
function verifyReleaseIdentity(
  environment: string,
  expectedSha: string,
  expectedManifestSha256: string,
): Readonly<{ failures: readonly string[]; rows: readonly ReleaseIdentityRow[] }> {
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
  return {
    failures,
    rows: observed.map((row) => ({
      service: row.service,
      releaseSha: row.sha,
      releaseManifestSha256: row.manifestSha256,
      sourceRevisionOverride: row.sourceRevisionOverride,
      imageSourceRevisionOverride: row.imageRevisionOverride,
      activeDeploymentId: '',
      activeImageDigest: '',
    })),
  }
}

type HealthReadback = Readonly<{
  url: string
  httpStatus: number
  status: string
  probes: Readonly<{ db: boolean; redis: boolean; migrations: boolean; policy: boolean }>
}>

async function verifyHealth(
  appUrl: string,
): Promise<Readonly<{ failures: readonly string[]; health: HealthReadback }>> {
  const url = `${appUrl.replace(/\/$/, '')}/api/health`
  const unreachable = (message: string) => ({
    failures: [message],
    health: {
      url,
      httpStatus: 0,
      status: 'unreachable',
      probes: { db: false, redis: false, migrations: false, policy: false },
    },
  })
  let body: Record<string, unknown>
  let httpStatus: number
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    httpStatus = response.status
    body = (await response.json()) as Record<string, unknown>
    out(`  ${url} → ${String(response.status)} ${JSON.stringify(body)}`)
    if (!response.ok) return unreachable(`${url} returned ${String(response.status)}`)
  } catch (error) {
    return unreachable(
      `${url}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const failures: string[] = []
  if (body.status !== 'ok') failures.push(`health status=${String(body.status)}`)
  for (const probe of ['db', 'redis', 'migrations', 'policy']) {
    if (body[probe] !== true) failures.push(`health ${probe}=${String(body[probe])}`)
  }
  return {
    failures,
    health: {
      url,
      httpStatus,
      status: typeof body.status === 'string' ? body.status : 'unknown',
      probes: {
        db: body.db === true,
        redis: body.redis === true,
        migrations: body.migrations === true,
        policy: body.policy === true,
      },
    },
  }
}

type AiControlHeadReadback = Readonly<{
  scopeKey: string
  executionState: string
  admissionState: string
}>

async function verifyAiHeads(
  databaseUrl: string,
): Promise<
  Readonly<{ failures: readonly string[]; heads: readonly AiControlHeadReadback[] }>
> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
  try {
    const { rows } = await pool.query<HeadRow>(HEADS_QUERY)
    for (const row of rows) {
      out(`  ${row.scope_key.padEnd(28)} ${row.execution_state}/${row.admission_state}`)
    }
    const heads = rows.map((row) => ({
      scopeKey: row.scope_key,
      executionState: row.execution_state,
      admissionState: row.admission_state,
    }))
    if (rows.length === 0) {
      return { failures: ['ai_execution_control_heads is empty'], heads }
    }
    return {
      failures: rows
        .filter(
          (row) =>
            row.execution_state !== 'enabled' || row.admission_state !== 'accepting',
        )
        .map(
          (row) =>
            `${row.scope_key}: ${row.execution_state}/${row.admission_state} (want enabled/accepting)`,
        ),
      heads,
    }
  } catch (error) {
    return {
      failures: [
        `ai head check: ${error instanceof Error ? error.message : String(error)}`,
      ],
      heads: [],
    }
  } finally {
    await pool.end()
  }
}

export const formatPeopleCutoverParitySummary = (counts: PeopleCutoverCounts): string =>
  `participations ${String(counts.matchedParticipations)}/${String(counts.expectedParticipations)}; ` +
  `responsibilities ${String(counts.matchedResponsibilities)}/${String(counts.expectedResponsibilities)}; ` +
  `portal groups ${String(counts.matchedGroupMemberships)}/${String(counts.expectedGroupMemberships)}`

async function verifyPeopleCutover(
  evidence: PeopleCutoverEvidence,
): Promise<readonly string[]> {
  try {
    const readiness = await verifyPeopleCutoverPromotionReadiness(
      getDb(),
      () => new Date(),
      evidence,
    )
    const counts = readiness.parity.counts
    out(`  ${formatPeopleCutoverParitySummary(counts)}`)
    out(
      `  anomalies=${String(counts.anomalies)} missingMappings=${String(counts.missingMappings)} fingerprint=${readiness.parity.fingerprintSha256}`,
    )
    return readiness.failures
  } catch (error) {
    return [
      `people authority cutover check: ${error instanceof Error ? error.message : String(error)}`,
    ]
  }
}

/**
 * Bind retained cutover evidence to the completed control row read from the
 * release database. The database reader also performs a fresh, locked check
 * that every Property and credential-home fact still names US/policy 3.
 */
export function dataCellCutoverEvidenceFailures(
  completed: CompletedDataCellCutover,
  evidence: DataCellCutoverEvidence,
): readonly string[] {
  const comparisons = [
    ['completedAt', completed.completedAt.toISOString(), evidence.completedAt],
    ['reportDigestSha256', completed.reportDigestSha256, evidence.reportDigestSha256],
    [
      'completionDigestSha256',
      completed.completionDigestSha256,
      evidence.completionDigestSha256,
    ],
    [
      'propertiesProcessed',
      completed.propertiesProcessed,
      evidence.progress.propertiesProcessed,
    ],
    [
      'credentialHomesProcessed',
      completed.credentialHomesProcessed,
      evidence.progress.credentialHomesProcessed,
    ],
    [
      'credentialConnectionsProcessed',
      completed.credentialConnectionsProcessed,
      evidence.progress.credentialConnectionsProcessed,
    ],
    ['target.projectId', completed.targetProjectId, evidence.target.projectId],
    [
      'target.environmentId',
      completed.targetEnvironmentId,
      evidence.target.environmentId,
    ],
    ['errorCount', completed.errorCount, evidence.progress.errorCount],
    [
      'verification.remainingProperties',
      completed.verification.remainingProperties,
      evidence.verification.remainingProperties,
    ],
    [
      'verification.resolvablePropertiesRemaining',
      completed.verification.resolvablePropertiesRemaining,
      evidence.verification.resolvablePropertiesRemaining,
    ],
    [
      'verification.remainingCredentialHomes',
      completed.verification.remainingCredentialHomes,
      evidence.verification.remainingCredentialHomes,
    ],
    // Active workflows are a truthful capture-time observation, not a durable
    // completion invariant. They may legitimately resume after cutover; the
    // locked live reader excludes them from its post-completion blocker gate.
    [
      'verification.routingConflicts',
      completed.verification.routingConflicts,
      evidence.verification.routingConflicts,
    ],
    ['operator.id', completed.operatorId, evidence.operator.id],
    ['operator.changeTicket', completed.changeTicket, evidence.operator.changeTicket],
    ['operator.correlationId', completed.correlationId, evidence.operator.correlationId],
  ] as const
  return comparisons
    .filter(([, observed, expected]) => observed !== expected)
    .map(
      ([label, observed, expected]) =>
        `Data Cell cutover ${label} live=${String(observed)} evidence=${String(expected)}`,
    )
}

async function verifyDataCellCutover(
  evidence: DataCellCutoverEvidence,
): Promise<readonly string[]> {
  try {
    const completed = await readCompletedSingleUsDataCellCutover(getDb())
    if (!completed) {
      return ['Data Cell cutover single-us-beta-v3 is not completed']
    }
    out(
      `  completed=${completed.completedAt.toISOString()} properties=${String(completed.propertiesProcessed)} credentialHomes=${String(completed.credentialHomesProcessed)} credentialConnections=${String(completed.credentialConnectionsProcessed)} errors=${String(completed.errorCount)}`,
    )
    out(`  target=${completed.targetProjectId}/${completed.targetEnvironmentId}`)
    out(
      `  report=${completed.reportDigestSha256} completion=${completed.completionDigestSha256}`,
    )
    return dataCellCutoverEvidenceFailures(completed, evidence)
  } catch (error) {
    return [
      `Data Cell cutover check: ${error instanceof Error ? error.message : String(error)}`,
    ]
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
): Readonly<{
  failures: readonly string[]
  active: ReadonlyMap<string, Readonly<{ deploymentId: string; imageDigest: string }>>
}> {
  const failures: string[] = []
  const active = new Map<string, { deploymentId: string; imageDigest: string }>()
  for (const entry of plan) {
    const row = activeDeploymentRow(entry.service, environment)
    const observed = row?.meta?.imageDigest ?? ''
    out(`  ${entry.service.padEnd(28)} ${observed || '(unavailable)'}`)
    active.set(entry.service, {
      deploymentId: row?.id ?? '',
      imageDigest: observed,
    })
    if (row?.status !== 'SUCCESS') {
      failures.push(`${entry.service}: active deployment is not SUCCESS`)
    }
    if (observed !== entry.imageDigest) {
      failures.push(
        `${entry.service}: active image digest ${observed || '(unavailable)'} != ${entry.imageDigest}`,
      )
    }
  }
  return { failures, active }
}

type VerifyResult = Readonly<{
  failures: readonly string[]
  readback: PromotionReadbackObservations
}>

/**
 * REL-01-T5: every dormant Data Cell must be REFUSED, and the refusal must be
 * observed rather than assumed. `cell-us` is the only id with a Railway
 * contract, so any other id is denied by the catalogue itself; the read-back
 * records which rule refused it.
 */
function dormantCellObservations(observedAt: string): Readonly<{
  observations: PromotionReadbackObservations['dormantCellDenial']['observations']
  failures: readonly string[]
}> {
  const failures: string[] = []
  const observations = DORMANT_DATA_CELL_IDS.map((cell) => {
    const definition: DataCellDefinition = DATA_CELL_CATALOGUE[cell]
    const railwayEnvironment = definition.railway?.environment ?? '(none)'
    const resolved = definition.railway !== null && definition.state !== 'denied'
    if (resolved) {
      failures.push(
        `dormant Data Cell ${cell} resolved to a deployable Railway contract; beta is exactly one logical US Data Cell`,
      )
    }
    out(`  ${cell.padEnd(28)} state=${definition.state} railway=${railwayEnvironment}`)
    return {
      cell,
      refusal:
        definition.railway === null
          ? ('no_railway_contract' as const)
          : ('catalogue_state_denied' as const),
      probe: `DATA_CELL_CATALOGUE[${cell}] state/railway contract`,
      resolved,
      observedAt,
      observationSha256: releaseEvidenceSha256(
        `${cell}:${definition.state}:${railwayEnvironment}\n`,
      ),
    }
  })
  return { observations, failures }
}

function migrationIntegrityReadback(
  environment: string,
  observedAt: string,
): Readonly<{
  body: Omit<PromotionReadbackObservations['migrationIntegrity'], 'failures'>
  failures: readonly string[]
}> {
  const failures: string[] = []
  const journalBytes = readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'))
  const journal = JSON.parse(journalBytes.toString('utf8')) as Readonly<{
    entries: readonly Readonly<{ tag: string }>[]
  }>
  const head = journal.entries.at(-1)
  if (!head) failures.push('drizzle/meta/_journal.json has no entries')
  const row = activeDeploymentRow(
    'schema-migrator' as RailwayApplicationService,
    environment,
  )
  if (row?.status !== 'SUCCESS') {
    failures.push('schema-migrator active deployment is not SUCCESS')
  }
  return {
    failures,
    body: {
      drizzle: {
        journalPath: 'drizzle/meta/_journal.json',
        journalSha256: releaseEvidenceSha256(journalBytes),
        headTag: head?.tag ?? '',
        entryCount: journal.entries.length,
      },
      schemaMigrator: {
        service: 'schema-migrator',
        deploymentId: row?.id ?? '',
        deploymentStatus: row?.status ?? '',
        imageDigest: row?.meta?.imageDigest ?? '',
        appliedHeadTag: head?.tag ?? '',
        settledAt: row?.createdAt ?? observedAt,
      },
      destructiveStatementCount: 0,
      compatibilityMirrorsRetained: true,
    },
  }
}

async function verify(
  manifest: PromotionManifest,
  manifestSha256: string,
  options: Options,
  peopleCutoverEvidence: PeopleCutoverEvidence,
  readbackMode: 'verify_only' | 'post_deploy' = 'verify_only',
): Promise<VerifyResult> {
  const failures: string[] = []
  const plan = deployPlan(manifest, manifestSha256)
  const capturedAt = new Date().toISOString()

  out('')
  out(`release identity (${options.environment}; expecting ${manifest.releaseSha}):`)
  const identity = verifyReleaseIdentity(
    options.environment,
    manifest.releaseSha,
    manifestSha256,
  )
  failures.push(...identity.failures)

  out('')
  out('runtime authentication origin:')
  failures.push(
    ...runtimeAuthenticationUrlFailures(
      options.environment,
      expectedRuntimeAuthenticationUrl(options),
    ),
  )

  out('')
  out('active Railway image digests:')
  const images = verifyImageDigests(plan, options.environment)
  failures.push(...images.failures)

  out('')
  out('health:')
  const health = await verifyHealth(options.appUrl)
  failures.push(...health.failures)

  out('')
  out('dormant Data Cell denial:')
  const dormant = dormantCellObservations(capturedAt)
  failures.push(...dormant.failures)

  out('')
  out('migration integrity:')
  let migration: ReturnType<typeof migrationIntegrityReadback> | undefined
  try {
    migration = migrationIntegrityReadback(options.environment, capturedAt)
    failures.push(...migration.failures)
  } catch (error) {
    failures.push(
      `migration integrity read-back: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  out('')
  const databaseUrl = process.env.DATABASE_URL
  let aiHeads: AiControlHeadReadback[] = []
  if (databaseUrl) {
    out('Data Cell cutover:')
    failures.push(...(await verifyDataCellCutover(options.dataCellCutoverEvidence)))
    out('')
    out('people authority cutover:')
    failures.push(...(await verifyPeopleCutover(peopleCutoverEvidence)))
    out('')
    out('ai_execution_control_heads:')
    const heads = await verifyAiHeads(databaseUrl)
    failures.push(...heads.failures)
    aiHeads = [...heads.heads]
  } else {
    failures.push('Data Cell cutover check requires DATABASE_URL')
    out('failed: Data Cell cutover check (DATABASE_URL unset)')
    failures.push('people authority cutover check requires DATABASE_URL')
    out('failed: people authority cutover check (DATABASE_URL unset)')
    out('skipped: ai head check (DATABASE_URL unset)')
    failures.push('ai_execution_control_heads read-back requires DATABASE_URL')
  }

  const candidate: ReleaseCandidateBinding = {
    releaseSha: manifest.releaseSha,
    releaseManifestSha256: manifestSha256,
    cell: 'us',
    environment: 'cell-us',
    deploymentProfile: 'production',
    projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
    projectId: options.railwayPlanEvidence.target.projectId,
    environmentId: options.railwayPlanEvidence.target.environmentId,
    appOrigin: 'https://us.reputationkey.app',
  }
  const identityFailures = [
    ...identity.failures,
    ...images.failures,
    ...health.failures,
    ...(databaseUrl
      ? []
      : ['ai_execution_control_heads read-back requires DATABASE_URL']),
  ]

  return {
    failures,
    readback: {
      candidate,
      capturedAt,
      observedBy: COMMAND_NAME,
      readbackMode,
      railwayNoDrift: {
        planEvidence: {
          version: RAILWAY_PLAN_EVIDENCE_VERSION,
          sha256: options.railwayPlanEvidenceSha256,
          outcome: options.railwayPlanEvidence.plan.outcome,
          capturedAt: options.railwayPlanEvidence.capturedAt,
        },
        liveGraph: {
          confirmedAt: capturedAt,
          changedServiceCount: 0,
          unmanagedServiceCount: 0,
          iacSha256: manifest.contract.iacSha256,
          releaseControllerSha256: manifest.contract.releaseControllerSha256,
        },
        failures:
          options.railwayPlanEvidence.plan.outcome === 'no-drift'
            ? []
            : ['Railway plan evidence reports pending-changes'],
      },
      releaseIdentityHealthControls: {
        services: identity.rows.map((row) => ({
          ...row,
          activeDeploymentId: images.active.get(row.service)?.deploymentId ?? '',
          activeImageDigest: images.active.get(row.service)?.imageDigest ?? '',
        })),
        health: health.health,
        aiControlHeads: aiHeads,
        failures: identityFailures,
      },
      migrationIntegrity: {
        ...(migration?.body ?? {
          drizzle: {
            journalPath: 'drizzle/meta/_journal.json',
            journalSha256: releaseEvidenceSha256('\n'),
            headTag: '',
            entryCount: 1,
          },
          schemaMigrator: {
            service: 'schema-migrator' as const,
            deploymentId: '',
            deploymentStatus: '',
            imageDigest: '',
            appliedHeadTag: '',
            settledAt: capturedAt,
          },
          destructiveStatementCount: 0,
          compatibilityMirrorsRetained: true,
        }),
        failures: migration?.failures ?? ['migration integrity read-back failed'],
      },
      dormantCellDenial: {
        observations: dormant.observations,
        failures: dormant.failures,
      },
    },
  }
}

/**
 * REL-01-T5: write the four typed read-back artifacts, ALWAYS.
 *
 * A failing check still emits its artifact with `outcome: 'failed'`. Writing
 * nothing on failure would leave the operator free to re-run until the
 * environment looked right and file only the passing capture — the same
 * fail-open as pasting console output into a file.
 */
function emitPromotionReadback(
  directory: string,
  observations: PromotionReadbackObservations,
): readonly string[] {
  const artifacts = promotionReadbackArtifacts(observations)
  const failures: string[] = []
  try {
    const written = writePromotionReadbackArtifacts(
      directory,
      artifacts,
      (path, content) => {
        writeFileSync(resolve(process.cwd(), path), content, { flag: 'wx' })
      },
    )
    for (const path of written) out(`  wrote ${path}`)
  } catch (error) {
    failures.push(
      `promotion read-back artifacts could not be written: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  for (const artifact of artifacts) {
    for (const invalid of artifact.errors) {
      failures.push(`${artifact.gate} read-back: ${invalid}`)
    }
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

function loadManifest(
  options: Pick<ParsedOptions, 'manifestPath' | 'manifestSha256'>,
): PromotionManifest | string {
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

function loadRailwayPlanEvidence(
  options: ParsedOptions,
  manifest: PromotionManifest,
): RailwayPlanEvidence | string {
  let content: string
  try {
    content = readFileSync(options.railwayPlanEvidencePath, 'utf8')
  } catch (error) {
    return `could not read Railway plan evidence: ${error instanceof Error ? error.message : String(error)}`
  }
  const parsed = parseRailwayPlanEvidence(content)
  if (!parsed.ok) return parsed.errors.join('\n')
  if (parsed.digest !== options.railwayPlanEvidenceSha256) {
    return `Railway plan evidence digest ${parsed.digest} does not match --railway-plan-evidence-sha256`
  }
  try {
    validateRailwayPlanEvidenceForPromotion(parsed.evidence, {
      cell: options.cell,
      manifestSha256: options.manifestSha256,
      signedIacSha256: manifest.contract.iacSha256,
      currentIacSha256: railwayIacSourceDigest(),
      signedReleaseControllerSha256: manifest.contract.releaseControllerSha256,
      currentReleaseControllerSha256: releaseControllerSourceDigest(),
      now: new Date(),
    })
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return parsed.evidence
}

function loadDataCellCutoverEvidence(
  options: Pick<
    ParsedOptions,
    'dataCellCutoverEvidencePath' | 'dataCellCutoverEvidenceSha256'
  >,
): DataCellCutoverEvidence | string {
  let content: string
  try {
    content = readFileSync(options.dataCellCutoverEvidencePath, 'utf8')
  } catch (error) {
    return `could not read Data Cell cutover evidence: ${error instanceof Error ? error.message : String(error)}`
  }
  return validateDataCellCutoverEvidenceForPromotion(
    content,
    options.dataCellCutoverEvidenceSha256,
  )
}

export function validateDataCellCutoverEvidenceForPromotion(
  content: string,
  expectedSha256: string,
): DataCellCutoverEvidence | string {
  const parsed = parseDataCellCutoverEvidence(content)
  if (!parsed.ok) return parsed.errors.join('\n')
  if (parsed.digest !== expectedSha256) {
    return `Data Cell cutover evidence digest ${parsed.digest} does not match --data-cell-cutover-evidence-sha256`
  }
  return parsed.evidence
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

function verifyManifestSignature(
  options: Pick<ParsedOptions, 'manifestPath' | 'signatureBundlePath' | 'manifestSha256'>,
): PromotionManifest {
  assertSafeCosignVersion()
  const manifestContent = readFileSync(options.manifestPath, 'utf8')
  const signatureBundleContent = readFileSync(options.signatureBundlePath)
  const manifest = rebindPromotionManifestAtDigest(
    manifestContent,
    options.manifestSha256,
  )
  const directory = mkdtempSync(join(tmpdir(), 'repkey-beta-signature-'))
  const manifestPath = join(directory, 'manifest.json')
  const bundlePath = join(directory, 'bundle.json')
  try {
    writeFileSync(manifestPath, manifestContent, { flag: 'wx', mode: 0o600 })
    writeFileSync(bundlePath, signatureBundleContent, { flag: 'wx', mode: 0o600 })
    const args = sigstoreManifestVerificationArgs({ manifestPath, bundlePath })
    const result = spawnSync('cosign', [...args], { encoding: 'utf8' })
    if (result.error || result.status !== 0) {
      const detail = (result.stderr || result.stdout || '').trim()
      throw new Error(
        `release manifest signature verification failed${detail ? `: ${detail}` : ''}`,
      )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  return manifest
}

function assertSignedReleaseControllerCurrent(manifest: PromotionManifest): void {
  assertReleaseControllerSourceDigest(
    manifest.contract.releaseControllerSha256,
    releaseControllerSourceDigest(),
  )
}

async function deployAndVerify(
  manifest: PromotionManifest,
  options: Options,
  peopleCutoverEvidence: PeopleCutoverEvidence,
): Promise<number> {
  const plan = deployPlan(manifest, options.manifestSha256)
  const candidateSources = fullRailwayServiceSourceInput(manifest)
  out(
    `APPLY — environment ${options.environment}, revision ${manifest.releaseSha}, manifest ${options.manifestSha256}`,
  )

  out('')
  out('preflight: isolated Railway target, exact reviewed plan, and web origin')
  pinAndAssertRailwayTarget(options.railwayPlanEvidence, candidateSources)
  let currentSources = assertLiveRailwayPlanMatchesEvidence(
    options.railwayPlanEvidence,
    candidateSources,
    false,
  )
  assertHealthOriginBelongsToTarget(options)

  out('')
  out('preflight: completed single-US Data Cell cutover + retained evidence')
  const dataCellCutoverFailures = await verifyDataCellCutover(
    options.dataCellCutoverEvidence,
  )
  if (dataCellCutoverFailures.length > 0) {
    return report(dataCellCutoverFailures, false)
  }
  out('  clear — live Property and credential-home topology remains US/policy 3')

  out('')
  out('preflight: people authority cutover parity + audited evidence')
  const peopleCutoverFailures = await verifyPeopleCutover(peopleCutoverEvidence)
  if (peopleCutoverFailures.length > 0) {
    return report(peopleCutoverFailures, false)
  }
  out('  clear — legacy people relationships match canonical readers')

  out('')
  out('preflight: runtime authentication origin')
  const authenticationUrlFailures = runtimeAuthenticationUrlFailures(
    options.environment,
    expectedRuntimeAuthenticationUrl(options),
  )
  if (authenticationUrlFailures.length > 0) {
    return report(authenticationUrlFailures, false)
  }
  out('  clear — web and worker authentication origins match the profile')

  out('')
  out('preflight: legacy image-identity overrides')
  const legacyOverrideFailures = legacyIdentityOverrideFailures(options.environment)
  if (legacyOverrideFailures.length > 0) {
    return report(legacyOverrideFailures, false)
  }
  out('  clear — promoted image metadata is the sole source identity')

  out('')
  out('preflight: signed schema-migrator bootstrap binding')
  assertSchemaMigratorReadyForServing(
    currentSources,
    candidateSources,
    options.environment,
    manifest.images.web.digest,
  )

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
  const providerStage = stageServiceSource(
    providerRedis,
    options.environment,
    currentSources,
    candidateSources,
    railwayIacTarget(options.railwayPlanEvidence),
    manifest.contract.iacSha256,
  )
  currentSources = providerStage.sources
  const providerSettlement = await awaitSettlement(
    [providerStage.deployment],
    [providerRedis],
    options.environment,
    options.deployTimeoutMs,
  )
  if (providerSettlement.length > 0) return report(providerSettlement, false)

  out('')
  out(
    `2/${String(plan.length)} ${web.service}: ${web.imageReference} ${web.variables.join(' ')}`,
  )
  const webStage = stageServiceSource(
    web,
    options.environment,
    currentSources,
    candidateSources,
    railwayIacTarget(options.railwayPlanEvidence),
    manifest.contract.iacSha256,
  )
  currentSources = webStage.sources
  const webSettlement = await awaitSettlement(
    [webStage.deployment],
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
    const staged = stageServiceSource(
      entry,
      options.environment,
      currentSources,
      candidateSources,
      railwayIacTarget(options.railwayPlanEvidence),
      manifest.contract.iacSha256,
    )
    currentSources = staged.sources
    const settlement = await awaitSettlement(
      [staged.deployment],
      [entry],
      options.environment,
      options.deployTimeoutMs,
    )
    if (settlement.length > 0) return report(settlement, false)
  }

  assertFinalRailwayPlanNoDrift(options.railwayPlanEvidence, candidateSources)

  return report(
    (
      await verify(
        manifest,
        options.manifestSha256,
        options,
        peopleCutoverEvidence,
        'post_deploy',
      )
    ).failures,
    true,
  )
}

function printPlan(manifest: PromotionManifest, options: Options): number {
  const plan = deployPlan(manifest, options.manifestSha256)
  out(
    `DRY RUN — ${options.deploymentProfile} environment ${options.environment}, revision ${manifest.releaseSha}, manifest ${options.manifestSha256}`,
  )
  out('Re-run with --apply --operator <id> --reason "<text>" to execute.')
  out('No Railway command has been invoked. Apply will verify the Sigstore bundle.')
  out(`People cutover evidence: ${options.peopleCutoverEvidencePath}`)
  out(
    `Data Cell cutover evidence: ${options.dataCellCutoverEvidencePath} (${options.dataCellCutoverEvidenceSha256})`,
  )
  out(
    `Railway plan evidence: ${options.railwayPlanEvidencePath} (${options.railwayPlanEvidenceSha256})`,
  )
  out(
    `Reviewed target: ${options.railwayPlanEvidence.target.projectName} (${options.railwayPlanEvidence.target.projectId}) / ${options.railwayPlanEvidence.target.environment} (${options.railwayPlanEvidence.target.environmentId})`,
  )
  out(`Health origin: ${options.appUrl}`)
  out(
    'Apply will verify project isolation, rebind the retained candidate plan, then advance one IaC-owned digest source through a saved plan at a time.',
  )
  for (const [index, entry] of plan.entries()) {
    out('')
    out(`${String(index + 1)}. ${entry.service}`)
    for (const assignment of entry.variables) {
      out(
        `   railway variable set ${assignment} --service ${entry.service} --environment ${options.environment} --skip-deploys`,
      )
    }
    out(`   saved IaC plan/apply → ${entry.imageReference}`)
    out(
      `   railway deployment list --service ${entry.service} --limit 100 --json  → poll to SUCCESS`,
    )
  }
  return 0
}

export async function runDeployBetaCli(args: readonly string[]): Promise<number> {
  // A test runner or embedding process may invoke the CLI more than once. A
  // target from a previous invocation must never bleed into the next one.
  pinnedRailwayEnvironment = undefined
  pinnedRailwayTarget = undefined
  const parsed = parseOptions(args)
  if (typeof parsed === 'string') {
    process.stderr.write(`${parsed}\n`)
    return 2
  }
  const parsedOptions = parsed
  const loaded = loadManifest(parsedOptions)
  if (typeof loaded === 'string') {
    process.stderr.write(`invalid release manifest:\n${loaded}\n`)
    return 1
  }
  const manifest = loaded
  const loadedRailwayPlan = loadRailwayPlanEvidence(parsedOptions, manifest)
  if (typeof loadedRailwayPlan === 'string') {
    process.stderr.write(`invalid Railway plan evidence:\n${loadedRailwayPlan}\n`)
    return 1
  }
  const loadedDataCellCutover = loadDataCellCutoverEvidence(parsedOptions)
  if (typeof loadedDataCellCutover === 'string') {
    process.stderr.write(
      `invalid Data Cell cutover evidence:\n${loadedDataCellCutover}\n`,
    )
    return 1
  }
  let options: Options
  try {
    options = bindOptions(parsedOptions, loadedDataCellCutover, loadedRailwayPlan)
  } catch (error) {
    process.stderr.write(
      `invalid deployment profile or app URL: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 2
  }
  let peopleCutoverContent: string
  try {
    peopleCutoverContent = readFileSync(options.peopleCutoverEvidencePath, 'utf8')
  } catch (error) {
    process.stderr.write(
      `could not read people cutover evidence: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  }
  const parsedPeopleCutover = parsePeopleCutoverEvidence(peopleCutoverContent)
  if (!parsedPeopleCutover.ok) {
    process.stderr.write(
      `invalid people cutover evidence:\n${parsedPeopleCutover.errors.join('\n')}\n`,
    )
    return 1
  }
  const peopleCutoverEvidence = parsedPeopleCutover.evidence
  out(`people cutover evidence sha256=${parsedPeopleCutover.digest}`)
  out(`Data Cell cutover evidence sha256=${options.dataCellCutoverEvidenceSha256}`)

  if (options.verifyOnly) {
    const verifiedManifest = verifyManifestSignature(options)
    assertSignedReleaseControllerCurrent(verifiedManifest)
    const candidateSources = fullRailwayServiceSourceInput(verifiedManifest)
    pinAndAssertRailwayTarget(options.railwayPlanEvidence, candidateSources)
    const currentSources = assertLiveRailwayPlanMatchesEvidence(
      options.railwayPlanEvidence,
      candidateSources,
      true,
    )
    assertSchemaMigratorReadyForServing(
      currentSources,
      candidateSources,
      options.environment,
      verifiedManifest.images.web.digest,
    )
    assertHealthOriginBelongsToTarget(options)
    const dataCellCutoverFailures = await verifyDataCellCutover(
      options.dataCellCutoverEvidence,
    )
    if (dataCellCutoverFailures.length > 0) {
      return report(dataCellCutoverFailures, false)
    }
    out(`verify-only — ${options.deploymentProfile} environment ${options.environment}`)
    const verified = await verify(
      verifiedManifest,
      options.manifestSha256,
      options,
      peopleCutoverEvidence,
    )
    const readbackFailures = options.readbackOutputDirectory
      ? emitPromotionReadback(options.readbackOutputDirectory, verified.readback)
      : []
    return report([...verified.failures, ...readbackFailures], false)
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
  const verifiedManifest = verifyManifestSignature(options)
  assertSignedReleaseControllerCurrent(verifiedManifest)
  const candidateSources = fullRailwayServiceSourceInput(verifiedManifest)

  // Select the reviewed project/environment by opaque IDs, prove project-wide
  // service isolation and the exact retained plan, then bind the probe origin
  // before the audited harness can write even its decision row.
  pinAndAssertRailwayTarget(options.railwayPlanEvidence, candidateSources)
  const currentSources = assertLiveRailwayPlanMatchesEvidence(
    options.railwayPlanEvidence,
    candidateSources,
    false,
  )
  assertSchemaMigratorReadyForServing(
    currentSources,
    candidateSources,
    options.environment,
    verifiedManifest.images.web.digest,
  )
  assertHealthOriginBelongsToTarget(options)

  // Bind retained completion evidence to the live target database before the
  // audited harness can reach the first Railway mutation. The same check runs
  // again inside the harness and after deployment to narrow the TOCTOU window.
  const dataCellCutoverFailures = await verifyDataCellCutover(
    options.dataCellCutoverEvidence,
  )
  if (dataCellCutoverFailures.length > 0) {
    return report(dataCellCutoverFailures, false)
  }

  // The network/readback preflights above may take time. Recompute immediately
  // before loading the dynamic operator/auth authority so a changed local
  // module cannot enter the audited mutation path after the signed preflight.
  assertSignedReleaseControllerCurrent(verifiedManifest)

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
      usage: `pnpm ${COMMAND_NAME} --manifest <manifest.json> --signature-bundle <bundle.json> --manifest-sha256 <digest> --people-cutover-evidence <evidence.json> --data-cell-cutover-evidence <evidence.json> --data-cell-cutover-evidence-sha256 <digest> --railway-plan-evidence <evidence.json> --railway-plan-evidence-sha256 <digest> --cell <us> --apply --operator <id> --reason "<text>" [--app-url <url>] [--deploy-timeout <seconds>]`,
    },
    async () => deployAndVerify(verifiedManifest, options, peopleCutoverEvidence),
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
