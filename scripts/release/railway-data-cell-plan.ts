import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DATA_CELL_IDS,
  type DataCellId,
} from '../../src/shared/domain/data-cell-catalogue'
import { sourceTreeDigest } from './iac-digest'
import {
  canonicalRailwayPlanEvidence,
  classifyRailwayPlanExit,
  createRailwayPlanEvidence,
  railwayPlanArgs,
  railwayPlanEvidenceSha256,
} from '../../src/shared/release/railway-plan-evidence'

export type RailwayLinkedTarget = Readonly<{
  project: string
  name: string
  environment: string
  environmentName: string
}>

const EXPECTED_PROJECT_NAME = 'reputation-key'
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
  cell: DataCellId,
  target: RailwayLinkedTarget,
): Readonly<{
  cell: DataCellId
  environment: string
  environmentId: string
  projectId: string
}> {
  const expectedEnvironment = `cell-${cell}`
  if (target.name !== EXPECTED_PROJECT_NAME) {
    throw new Error(
      `Railway project mismatch: expected ${EXPECTED_PROJECT_NAME}, linked ${target.name}`,
    )
  }
  if (target.environmentName !== expectedEnvironment) {
    throw new Error(
      `Railway Data Cell environment mismatch: expected ${expectedEnvironment}, linked ${target.environmentName}`,
    )
  }
  return {
    cell,
    environment: target.environmentName,
    environmentId: target.environment,
    projectId: target.project,
  }
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : undefined
  return value?.startsWith('--') ? undefined : value
}

function parseCell(args: readonly string[]): DataCellId {
  const value = flagValue(args, '--cell')
  if (!DATA_CELL_IDS.includes(value as DataCellId)) {
    throw new Error(`--cell must be one of ${DATA_CELL_IDS.join(', ')}`)
  }
  return value as DataCellId
}

export type RailwayPlanEvidenceFiles = Readonly<{
  path: string
  content: string
  digest: string
  sidecarPath: string
  sidecarContent: string
}>

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
    cell: DataCellId
    target: Readonly<{ projectId: string; environment: string; environmentId: string }>
    iacSha256: string
    exitCode: number
    rawPlan: string
  }>,
): RailwayPlanEvidenceFiles {
  const evidence = createRailwayPlanEvidence({
    capturedAt: input.capturedAt,
    cell: input.cell,
    target: input.target,
    iacSha256: input.iacSha256,
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

export function runRailwayDataCellPlanCli(args: readonly string[]): number {
  try {
    const cell = parseCell(args)
    const callerEnvironment = {
      ...process.env,
      RAILWAY_CALLER: process.env.RAILWAY_CALLER ?? 'repo:railway-data-cell-plan',
      RAILWAY_AGENT_SESSION:
        process.env.RAILWAY_AGENT_SESSION ?? `repkey-data-cell-plan-${cell}`,
    }
    const status = spawnSync('railway', ['status'], {
      encoding: 'utf8',
      env: callerEnvironment,
    })
    if (status.status !== 0) {
      throw new Error(status.stderr.trim() || 'railway status failed')
    }
    const target = assertRailwayDataCellTarget(
      cell,
      parseRailwayLinkedTarget(status.stdout),
    )
    process.stderr.write(
      `Planning ${target.cell} against ${target.environment} (${target.environmentId}) in project ${target.projectId}\n`,
    )

    // stdout is captured for evidence; stderr stays attached so the operator
    // still sees Railway's own progress and diagnostics live.
    const plan = spawnSync('railway', railwayPlanArgs({ iacFile: IAC_FILE }), {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'inherit'],
      env: {
        ...callerEnvironment,
        REPKEY_RAILWAY_CELL_ENVIRONMENT: target.environment,
      },
    })
    if (plan.error) throw plan.error

    const exitCode = plan.status ?? 1
    // Throws for any code outside the documented 0/2 contract, so a blocking
    // plan can never be written out as if it were reviewable evidence.
    const outcome = classifyRailwayPlanExit(exitCode)

    const evidenceOut = flagValue(args, '--evidence-out')
    if (evidenceOut) {
      const files = buildRailwayPlanEvidenceFiles({
        outputPath: resolve(evidenceOut),
        capturedAt: new Date(),
        cell,
        target: {
          projectId: target.projectId,
          environment: target.environment,
          environmentId: target.environmentId,
        },
        iacSha256: sourceTreeDigest([IAC_ROOT]),
        exitCode,
        rawPlan: plan.stdout,
      })
      // 'wx' keeps a retained plan immutable: recapturing writes a new file
      // rather than silently replacing reviewed evidence.
      writeFileSync(files.path, files.content, { encoding: 'utf8', flag: 'wx' })
      writeFileSync(files.sidecarPath, files.sidecarContent, {
        encoding: 'utf8',
        flag: 'wx',
      })
      process.stderr.write(`${outcome} — evidence ${files.digest} at ${files.path}\n`)
    } else {
      process.stdout.write(plan.stdout)
      process.stderr.write(`${outcome} — pass --evidence-out to retain this plan\n`)
    }

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
