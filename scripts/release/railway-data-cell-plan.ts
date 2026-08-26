import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DATA_CELL_IDS,
  type DataCellId,
} from '../../src/shared/domain/data-cell-catalogue'

export type RailwayLinkedTarget = Readonly<{
  project: string
  name: string
  environment: string
  environmentName: string
}>

const EXPECTED_PROJECT_NAME = 'reputation-key'

function nonEmpty(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`Railway status did not report ${label}`)
  return value.trim()
}

/** Parse the stable identity block emitted by `railway status` without secrets. */
export function parseRailwayLinkedTarget(output: string): RailwayLinkedTarget {
  const plain = output.replaceAll(/\u001b\[[0-9;]*m/gu, '')
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

function parseCell(args: readonly string[]): DataCellId {
  const inline = args.find((arg) => arg.startsWith('--cell='))?.slice('--cell='.length)
  const index = args.indexOf('--cell')
  const value = inline ?? (index >= 0 ? args[index + 1] : undefined)
  if (!DATA_CELL_IDS.includes(value as DataCellId)) {
    throw new Error(`--cell must be one of ${DATA_CELL_IDS.join(', ')}`)
  }
  return value as DataCellId
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

    const plan = spawnSync('railway', ['config', 'plan', '--yes'], {
      stdio: 'inherit',
      env: {
        ...callerEnvironment,
        REPKEY_RAILWAY_CELL_ENVIRONMENT: target.environment,
      },
    })
    if (plan.error) throw plan.error
    return plan.status ?? 1
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
