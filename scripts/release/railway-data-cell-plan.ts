import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BETA_DEPLOYMENT_DATA_CELL_IDS,
  isBetaDeploymentDataCellId,
  type BetaDeploymentDataCellId,
} from '../../src/shared/domain/data-cell-catalogue'
import { railwayIacSourceDigest } from './iac-digest'
import {
  canonicalRailwayPlanEvidence,
  classifyRailwayPlanExit,
  createRailwayPlanEvidence,
  railwayPlanArgs,
  railwayPlanEvidenceSha256,
  type RailwayPlanEvidence,
} from '../../src/shared/release/railway-plan-evidence'
import {
  assertRailwayProjectNameForProfile,
  REPKEY_RAILWAY_PROJECT_NAME_ENV,
  requireRailwayDeploymentProfile,
  type RailwayDeploymentProfile,
} from '../../src/shared/release/railway-deployment-profile'
import {
  parsePromotionManifest,
  type PromotionManifest,
} from '../../src/shared/release/promotion-manifest'
import {
  assertRailwayFullProjectVisibilityCredential,
  assertSingleUsBetaRailwayProjectIsolation,
  parseRailwayProjectServiceInventory,
  railwayFullProjectStatusArgs,
} from '../../src/shared/release/railway-project-service-isolation'
import {
  assertRailwayCliSupportsPinnedPlans,
  fullRailwayServiceSourceInput,
  inspectFullCandidateRailwayPlan,
  railwaySourceMapEnvironment,
  type RailwayIacTarget,
} from './staged-railway-sources'
import {
  RAILWAY_SERVICE_SOURCE_MAP_ENV,
  type RailwayServiceSourceInput,
} from '../../.railway/service-source-map'
import {
  assertReleaseControllerSourceDigest,
  releaseControllerSourceDigest,
} from './release-authority-digest'

export type RailwayLinkedTarget = Readonly<{
  project: string
  name: string
  /** Railway's opaque environment identifier, not its human-readable name. */
  environment: string
  environmentName: string
}>

/**
 * Pin every Railway child process to opaque target IDs after the human-linked
 * target has been checked. This closes the gap where the local Railway link
 * could change between `railway status` and `railway config plan`.
 */
export function railwayTargetEnvironment(
  target: Pick<RailwayLinkedTarget, 'project' | 'name' | 'environment'>,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...baseEnvironment,
    RAILWAY_PROJECT_ID: target.project,
    RAILWAY_ENVIRONMENT_ID: target.environment,
    [REPKEY_RAILWAY_PROJECT_NAME_ENV]: target.name,
  }
}

/** The repository graph is the target authority; never plan against service config. */
const IAC_ROOT = '.railway'
const IAC_FILE = `${IAC_ROOT}/railway.ts`
const ANSI_COLOR_SEQUENCE = new RegExp(`${String.fromCodePoint(27)}\\[[0-9;]*m`, 'gu')

function nonEmpty(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`Railway status did not report ${label}`)
  return value.trim()
}

/** Parse the stable identity block emitted by `railway status` without secrets. */
export function parseRailwayLinkedTarget(output: string): RailwayLinkedTarget {
  const plain = output.replaceAll(ANSI_COLOR_SEQUENCE, '')
  const field = (name: string): string | undefined =>
    new RegExp(`^${name}:\\s+(.+)$`, 'mu').exec(plain)?.[1]

  return {
    name: nonEmpty(field('Project'), 'the linked project name'),
    project: nonEmpty(field('Project ID'), 'the linked project ID'),
    environmentName: nonEmpty(field('Environment'), 'the linked environment name'),
    environment: nonEmpty(field('Environment ID'), 'the linked environment ID'),
  }
}

/**
 * Fail closed before a plan can be evaluated against a differently linked
 * project or environment. This is intentionally also used for read-only
 * planning: a plausible plan for the wrong cell is unsafe evidence.
 */
export function assertRailwayDataCellTarget(
  cell: BetaDeploymentDataCellId,
  deploymentProfile: RailwayDeploymentProfile,
  target: RailwayLinkedTarget,
): Readonly<{
  cell: BetaDeploymentDataCellId
  deploymentProfile: RailwayDeploymentProfile
  environment: `cell-${BetaDeploymentDataCellId}`
  environmentId: string
  projectName: string
  projectId: string
}> {
  const expectedEnvironment: `cell-${BetaDeploymentDataCellId}` = `cell-${cell}`
  assertRailwayProjectNameForProfile(deploymentProfile, target.name)
  if (target.environmentName !== expectedEnvironment) {
    throw new Error(
      `Railway Data Cell environment mismatch: expected ${expectedEnvironment}, linked ${target.environmentName}`,
    )
  }
  return {
    cell,
    deploymentProfile,
    environment: expectedEnvironment,
    environmentId: target.environment,
    projectName: target.name,
    projectId: target.project,
  }
}

/**
 * Bind a later promotion to the exact project/environment identity that an
 * operator reviewed. Human-readable names alone are insufficient because they
 * can be recreated or duplicated; both opaque IDs must also match.
 */
export function assertRailwayTargetMatchesPlanEvidence(
  evidence: RailwayPlanEvidence,
  target: RailwayLinkedTarget,
): void {
  assertRailwayDataCellTarget(evidence.cell, evidence.deploymentProfile, target)
  const expected = evidence.target
  const comparisons = [
    ['project name', expected.projectName, target.name],
    ['project ID', expected.projectId, target.project],
    ['environment name', expected.environment, target.environmentName],
    ['environment ID', expected.environmentId, target.environment],
  ] as const
  for (const [label, wanted, observed] of comparisons) {
    if (wanted !== observed) {
      throw new Error(
        `Railway target mismatch for ${label}: plan evidence=${wanted}, linked=${observed}`,
      )
    }
  }
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : undefined
  return value?.startsWith('--') ? undefined : value
}

function parseCell(args: readonly string[]): BetaDeploymentDataCellId {
  const value = flagValue(args, '--cell')
  if (!value || !isBetaDeploymentDataCellId(value)) {
    throw new Error(`--cell must be one of ${BETA_DEPLOYMENT_DATA_CELL_IDS.join(', ')}`)
  }
  return value
}

function parseDeploymentProfile(args: readonly string[]): RailwayDeploymentProfile {
  return requireRailwayDeploymentProfile(flagValue(args, '--deployment-profile'))
}

export type RailwayPlanEvidenceFiles = Readonly<{
  path: string
  content: string
  digest: string
  sidecarPath: string
  sidecarContent: string
}>

/**
 * Prove the raw plan is the exact full-candidate graph for the reviewed target
 * before it can be represented by retained evidence. Exit status and change
 * count must agree as well; a contradictory CLI result is never reviewable.
 */
export function assertRailwayFullCandidatePlanReviewable(
  rawPlan: string,
  exitCode: number,
  target: RailwayIacTarget,
  candidate: RailwayServiceSourceInput,
): ReturnType<typeof inspectFullCandidateRailwayPlan> {
  const outcome = classifyRailwayPlanExit(exitCode)
  const inspection = inspectFullCandidateRailwayPlan(rawPlan, target, candidate)
  if (outcome === 'no-drift' && inspection.changeCount !== 0) {
    throw new Error('Railway no-drift plan reported pending graph changes')
  }
  if (outcome === 'pending-changes' && inspection.changeCount === 0) {
    throw new Error('Railway pending plan did not report a graph change')
  }
  return inspection
}

/**
 * Render the retained artifact pair without touching the filesystem, so the
 * evidence shape is provable in tests rather than only observable after a live
 * plan. The sidecar uses the `shasum -c` format the release scripts already
 * write beside promotion manifests.
 */
export function buildRailwayPlanEvidenceFiles(
  input: Readonly<{
    outputPath: string
    capturedAt: Date
    cell: BetaDeploymentDataCellId
    deploymentProfile: RailwayDeploymentProfile
    target: Readonly<{
      projectName: string
      projectId: string
      environment: `cell-${BetaDeploymentDataCellId}`
      environmentId: string
    }>
    iacSha256: string
    releaseManifestSha256: string
    releaseControllerSha256: string
    exitCode: number
    rawPlan: string
  }>,
): RailwayPlanEvidenceFiles {
  const evidence = createRailwayPlanEvidence({
    capturedAt: input.capturedAt,
    cell: input.cell,
    deploymentProfile: input.deploymentProfile,
    target: input.target,
    iacSha256: input.iacSha256,
    releaseManifestSha256: input.releaseManifestSha256,
    releaseControllerSha256: input.releaseControllerSha256,
    exitCode: input.exitCode,
    rawPlan: input.rawPlan,
  })
  const content = canonicalRailwayPlanEvidence(evidence)
  const digest = railwayPlanEvidenceSha256(content)
  return {
    path: input.outputPath,
    content,
    digest,
    sidecarPath: `${input.outputPath}.sha256`,
    sidecarContent: `${digest}  ${basename(input.outputPath)}\n`,
  }
}

type RailwayDataCellTarget = ReturnType<typeof assertRailwayDataCellTarget>

type VerifiedPromotionInputs = Readonly<{
  manifest: PromotionManifest
  manifestDigest: string
  iacSha256: string
  releaseControllerSha256: string
}>

/**
 * Re-prove the promotion manifest against its declared digest and against the
 * IaC and release-controller sources as they stand right now.
 */
function verifyPromotionInputs(args: readonly string[]): VerifiedPromotionInputs {
  const manifestPath = flagValue(args, '--manifest')
  const manifestDigest = flagValue(args, '--manifest-sha256')
  if (!manifestPath || !manifestDigest) {
    throw new Error('--manifest and --manifest-sha256 are required')
  }
  if (!/^[0-9a-f]{64}$/u.test(manifestDigest)) {
    throw new Error('--manifest-sha256 must be a lowercase sha256')
  }
  const parsedManifest = parsePromotionManifest(
    readFileSync(resolve(manifestPath), 'utf8'),
  )
  if (!parsedManifest.ok) {
    throw new Error(parsedManifest.errors.join('\n'))
  }
  if (parsedManifest.digest !== manifestDigest) {
    throw new Error(
      `promotion manifest digest ${parsedManifest.digest} does not match --manifest-sha256`,
    )
  }
  const iacSha256 = railwayIacSourceDigest()
  if (parsedManifest.manifest.contract.iacSha256 !== iacSha256) {
    throw new Error(
      `promotion manifest IaC digest ${parsedManifest.manifest.contract.iacSha256} does not match current ${iacSha256}`,
    )
  }
  const releaseControllerSha256 = releaseControllerSourceDigest()
  assertReleaseControllerSourceDigest(
    parsedManifest.manifest.contract.releaseControllerSha256,
    releaseControllerSha256,
  )
  return {
    manifest: parsedManifest.manifest,
    manifestDigest,
    iacSha256,
    releaseControllerSha256,
  }
}

/** Confirm the CLI supports pinned plans and resolve the linked data-cell target. */
function resolveLinkedDataCellTarget(
  cell: BetaDeploymentDataCellId,
  deploymentProfile: RailwayDeploymentProfile,
  callerEnvironment: NodeJS.ProcessEnv,
): RailwayDataCellTarget {
  const version = spawnSync('railway', ['--version'], {
    encoding: 'utf8',
    env: callerEnvironment,
  })
  if (version.error || version.status !== 0) {
    throw new Error(version.stderr.trim() || 'railway --version failed')
  }
  assertRailwayCliSupportsPinnedPlans(`${version.stdout ?? ''}\n${version.stderr ?? ''}`)
  const status = spawnSync('railway', ['status'], {
    encoding: 'utf8',
    env: callerEnvironment,
  })
  if (status.status !== 0) {
    throw new Error(status.stderr.trim() || 'railway status failed')
  }
  return assertRailwayDataCellTarget(
    cell,
    deploymentProfile,
    parseRailwayLinkedTarget(status.stdout),
  )
}

function assertProjectIsolationForTarget(
  target: RailwayDataCellTarget,
  pinnedEnvironment: NodeJS.ProcessEnv,
): void {
  const projectStatus = spawnSync('railway', [...railwayFullProjectStatusArgs()], {
    encoding: 'utf8',
    env: pinnedEnvironment,
  })
  if (projectStatus.error || projectStatus.status !== 0) {
    throw new Error(projectStatus.stderr.trim() || 'railway status --json failed')
  }
  assertSingleUsBetaRailwayProjectIsolation(
    parseRailwayProjectServiceInventory(projectStatus.stdout),
    {
      projectId: target.projectId,
      projectName: target.projectName,
      environmentId: target.environmentId,
      environmentName: target.environment,
    },
  )
}

/** Retain the plan as immutable evidence, or print it when none was requested. */
function retainOrPrintPlan(
  args: readonly string[],
  input: Readonly<{
    target: RailwayDataCellTarget
    verified: VerifiedPromotionInputs
    exitCode: number
    outcome: string
    rawPlan: string
  }>,
): void {
  const { target, verified, exitCode, outcome, rawPlan } = input
  const evidenceOut = flagValue(args, '--evidence-out')
  if (!evidenceOut) {
    process.stdout.write(rawPlan)
    process.stderr.write(`${outcome} — pass --evidence-out to retain this plan\n`)
    return
  }
  const files = buildRailwayPlanEvidenceFiles({
    outputPath: resolve(evidenceOut),
    capturedAt: new Date(),
    cell: target.cell,
    deploymentProfile: target.deploymentProfile,
    target: {
      projectName: target.projectName,
      projectId: target.projectId,
      environment: target.environment,
      environmentId: target.environmentId,
    },
    iacSha256: verified.iacSha256,
    releaseManifestSha256: verified.manifestDigest,
    releaseControllerSha256: verified.releaseControllerSha256,
    exitCode,
    rawPlan,
  })
  // 'wx' keeps a retained plan immutable: recapturing writes a new file
  // rather than silently replacing reviewed evidence.
  writeFileSync(files.path, files.content, { encoding: 'utf8', flag: 'wx' })
  writeFileSync(files.sidecarPath, files.sidecarContent, {
    encoding: 'utf8',
    flag: 'wx',
  })
  process.stderr.write(`${outcome} — evidence ${files.digest} at ${files.path}\n`)
}

export function runRailwayDataCellPlanCli(args: readonly string[]): number {
  try {
    const cell = parseCell(args)
    const deploymentProfile = parseDeploymentProfile(args)
    const verified = verifyPromotionInputs(args)
    const candidateSourceInput = fullRailwayServiceSourceInput(verified.manifest)
    const sourceMap = railwaySourceMapEnvironment(candidateSourceInput)
    const callerEnvironment = {
      ...process.env,
      RAILWAY_CALLER: process.env.RAILWAY_CALLER ?? 'repo:railway-data-cell-plan',
      RAILWAY_AGENT_SESSION:
        process.env.RAILWAY_AGENT_SESSION ?? `repkey-data-cell-plan-${cell}`,
    }
    assertRailwayFullProjectVisibilityCredential(callerEnvironment)
    const target = resolveLinkedDataCellTarget(cell, deploymentProfile, callerEnvironment)
    process.stderr.write(
      `Planning ${target.deploymentProfile}/${target.cell} against ${target.environment} (${target.environmentId}) in ${target.projectName} (${target.projectId})\n`,
    )

    const pinnedEnvironment = {
      ...railwayTargetEnvironment(
        {
          project: target.projectId,
          name: target.projectName,
          environment: target.environmentId,
        },
        callerEnvironment,
      ),
      REPKEY_RAILWAY_CELL_ENVIRONMENT: target.environment,
      REPKEY_RAILWAY_DEPLOYMENT_PROFILE: target.deploymentProfile,
      [RAILWAY_SERVICE_SOURCE_MAP_ENV]: sourceMap,
    }
    assertProjectIsolationForTarget(target, pinnedEnvironment)

    // stdout is captured for evidence; stderr stays attached so the operator
    // still sees Railway's own progress and diagnostics live.
    const plan = spawnSync('railway', railwayPlanArgs({ iacFile: IAC_FILE }), {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'inherit'],
      env: pinnedEnvironment,
    })
    if (plan.error) throw plan.error

    const exitCode = plan.status ?? 1
    // Throws for any code outside the documented 0/2 contract, so a blocking
    // plan can never be written out as if it were reviewable evidence.
    const outcome = classifyRailwayPlanExit(exitCode)
    assertRailwayFullCandidatePlanReviewable(
      plan.stdout,
      exitCode,
      {
        projectId: target.projectId,
        projectName: target.projectName,
        environmentId: target.environmentId,
        environment: target.environment,
      },
      candidateSourceInput,
    )

    retainOrPrintPlan(args, {
      target,
      verified,
      exitCode,
      outcome,
      rawPlan: plan.stdout,
    })

    return exitCode
  } catch (error) {
    process.stderr.write(
      `Railway Data Cell plan refused: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runRailwayDataCellPlanCli(process.argv.slice(2))
}
