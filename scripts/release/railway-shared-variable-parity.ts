import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APPLICATION_SERVICE_NAMES,
  APPLICATION_SHARED_VARIABLES,
} from '../../.railway/railway'

export type RailwayServiceVariableSnapshot = Readonly<{
  service: string
  variables: Readonly<Record<string, string>>
}>

type SharedVariableMatch = Readonly<{
  name: string
  status: 'match'
  availability: 'set' | 'unset'
}>

type SharedVariableMismatch = Readonly<{
  name: string
  status: 'mismatch'
  observations: ReadonlyArray<
    Readonly<{
      service: string
      valueGroup: string
    }>
  >
}>

export type SharedVariableParityResult = SharedVariableMatch | SharedVariableMismatch

type ObservedValue =
  | Readonly<{ service: string; state: 'unset' }>
  | Readonly<{ service: string; state: 'set'; value: string }>

function observeVariable(
  snapshot: RailwayServiceVariableSnapshot,
  name: string,
): ObservedValue {
  if (!Object.hasOwn(snapshot.variables, name)) {
    return { service: snapshot.service, state: 'unset' }
  }
  return {
    service: snapshot.service,
    state: 'set',
    value: snapshot.variables[name] ?? '',
  }
}

/** Compare exact values without returning or rendering any live variable value. */
export function compareSharedVariableParity(
  variableNames: readonly string[],
  snapshots: readonly RailwayServiceVariableSnapshot[],
): readonly SharedVariableParityResult[] {
  if (snapshots.length < 2) {
    throw new Error('Shared-variable parity requires at least two service snapshots')
  }
  if (new Set(snapshots.map(({ service }) => service)).size !== snapshots.length) {
    throw new Error('Shared-variable parity received a duplicate service snapshot')
  }

  return variableNames.map((name) => {
    const observations = snapshots.map((snapshot) => observeVariable(snapshot, name))
    const first = observations[0]
    if (!first) throw new Error('Shared-variable parity received no observations')

    const matches = observations.every(
      (observation) =>
        observation.state === first.state &&
        (observation.state === 'unset' ||
          (first.state === 'set' && observation.value === first.value)),
    )
    if (matches) {
      return {
        name,
        status: 'match',
        availability: first.state,
      }
    }

    const valueGroups: string[] = []
    return {
      name,
      status: 'mismatch',
      observations: observations.map((observation) => {
        if (observation.state === 'unset') {
          return { service: observation.service, valueGroup: '<unset>' }
        }
        let groupIndex = valueGroups.indexOf(observation.value)
        if (groupIndex === -1) {
          valueGroups.push(observation.value)
          groupIndex = valueGroups.length - 1
        }
        return {
          service: observation.service,
          valueGroup: `value#${String(groupIndex + 1)}`,
        }
      }),
    }
  })
}

export function formatSharedVariableParityReport(
  environment: string,
  serviceNames: readonly string[],
  results: readonly SharedVariableParityResult[],
): string {
  const mismatches = results.filter((result) => result.status === 'mismatch')
  const lines = [
    'Railway application shared-variable parity',
    `Environment: ${environment}`,
    `Services: ${serviceNames.join(', ')}`,
    '',
  ]

  for (const result of results) {
    if (result.status === 'match') {
      lines.push(
        `PASS ${result.name}: ${
          result.availability === 'set'
            ? 'identical on every service'
            : 'unset on every service'
        }`,
      )
      continue
    }
    lines.push(
      `FAIL ${result.name}: ${result.observations
        .map(({ service, valueGroup }) => `${service}=${valueGroup}`)
        .join(', ')}`,
    )
  }

  lines.push('')
  lines.push(
    mismatches.length === 0
      ? `PASS: ${String(results.length)}/${String(results.length)} shared variables have identical values across ${String(serviceNames.length)} application services.`
      : `FAIL: ${String(mismatches.length)}/${String(results.length)} shared variables differ across the application services.`,
  )
  return `${lines.join('\n')}\n`
}

function parseVariableList(
  output: string,
  service: string,
): Readonly<Record<string, string>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    throw new Error(`Railway returned invalid variable JSON for ${service}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Railway returned a non-object variable list for ${service}`)
  }

  const variables: Record<string, string> = {}
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(`Railway returned a non-string value for ${service}.${name}`)
    }
    variables[name] = value
  }
  return variables
}

function readServiceVariables(
  service: string,
  environment: string,
  railwayEnvironment: NodeJS.ProcessEnv,
): RailwayServiceVariableSnapshot {
  const result = spawnSync(
    'railway',
    ['variable', 'list', '--service', service, '--environment', environment, '--json'],
    {
      encoding: 'utf8',
      env: railwayEnvironment,
    },
  )
  if (result.error) {
    throw new Error(
      `railway variable list failed for ${service}: ${result.error.message}`,
    )
  }
  if (result.status !== 0) {
    throw new Error(
      `railway variable list failed for ${service}: ${
        result.stderr.trim() || `exit ${String(result.status ?? 1)}`
      }`,
    )
  }
  return {
    service,
    variables: parseVariableList(result.stdout, service),
  }
}

const USAGE =
  'Usage: pnpm infra:railway:check-shared-variables --environment <environment>'

export function runRailwaySharedVariableParityCli(args: readonly string[]): number {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  if (
    args.length !== 2 ||
    args[0] !== '--environment' ||
    !args[1] ||
    args[1].startsWith('--')
  ) {
    process.stderr.write(`${USAGE}\n`)
    return 1
  }

  const environment = args[1]
  const railwayEnvironment = {
    ...process.env,
    RAILWAY_CALLER: process.env.RAILWAY_CALLER ?? 'repo:railway-shared-variable-parity',
    RAILWAY_AGENT_SESSION:
      process.env.RAILWAY_AGENT_SESSION ??
      `repkey-shared-variable-parity-${environment.replaceAll(/[^a-zA-Z0-9_-]/gu, '-')}`,
  }

  try {
    const snapshots = APPLICATION_SERVICE_NAMES.map((service) =>
      readServiceVariables(service, environment, railwayEnvironment),
    )
    const results = compareSharedVariableParity(APPLICATION_SHARED_VARIABLES, snapshots)
    process.stdout.write(
      formatSharedVariableParityReport(environment, APPLICATION_SERVICE_NAMES, results),
    )
    return results.some((result) => result.status === 'mismatch') ? 1 : 0
  } catch (error) {
    process.stderr.write(
      `Railway shared-variable parity check failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    )
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runRailwaySharedVariableParityCli(process.argv.slice(2))
}
