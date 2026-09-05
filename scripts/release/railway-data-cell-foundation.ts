import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createRailwayContext } from 'railway/iac'
import { buildRailwayProject } from '../../.railway/railway'
import {
  CANONICAL_RAILWAY_FOUNDATION_SOURCE_INPUT,
  RAILWAY_FOUNDATION_SOURCE_INPUT,
  RAILWAY_SERVICE_SOURCE_MAP_ENV,
} from '../../.railway/service-source-map'
import {
  BETA_DEPLOYMENT_DATA_CELL_IDS,
  isBetaDeploymentDataCellId,
} from '../../src/shared/domain/data-cell-catalogue'
import {
  array,
  record,
  type JsonRecord,
} from '../../src/shared/release/json-shape-guards'
import {
  PRODUCTION_RAILWAY_PROJECT_NAME,
  REHEARSAL_RAILWAY_PROJECT_NAME,
  requireRailwayDeploymentProfile,
  type RailwayDeploymentProfile,
} from '../../src/shared/release/railway-deployment-profile'
import {
  assertRailwayFullProjectVisibilityCredential,
  assertSingleUsBetaRailwayFoundationReadback,
  assertSingleUsBetaRailwayFoundationIsolation,
  parseRailwayProjectServiceInventory,
  railwayFullProjectStatusArgs,
} from '../../src/shared/release/railway-project-service-isolation'
import { railwayPlanArgs } from '../../src/shared/release/railway-plan-evidence'
import { readOnce } from '../../src/shared/release/read-once'
import { railwayTargetEnvironment } from './railway-data-cell-plan'
import {
  MINIMUM_PINNED_PLAN_RAILWAY_CLI_VERSION,
  assertRailwayCliSupportsPinnedPlans,
  railwayPinnedApplyArgs,
  railwayPinnedPlanArgs,
  railwaySavedPlanSourceTree,
} from './staged-railway-sources'

const IAC_FILE = '.railway/railway.ts'
const SHA256 = /^[0-9a-f]{64}$/u
const SAVED_CHANGE_SET_SHA256 = /^sha256:[0-9a-f]{64}$/u
const FOUNDATION_GRAPH_SHA256_BY_PROFILE = Object.freeze({
  production: '9c8c68c879ff1c930458998d7d61b8b81b55f9b7e0be749bf82042573a587bd2',
  rehearsal: 'a6758ee54f42339a6c33ad55151873913c96dd35b826ba453f741ab8c77327e6',
} satisfies Readonly<Record<RailwayDeploymentProfile, string>>)

export type RailwayFoundationCommandResult = Readonly<{
  status: number
  stdout: string
  stderr: string
  error?: Error
}>

export type RailwayFoundationExecutor = (
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
) => RailwayFoundationCommandResult

export type RailwayFoundationGraphTarget = Readonly<{
  deploymentProfile: RailwayDeploymentProfile
  projectId: string
  projectName: string
  environmentId: string
  environmentName: 'cell-us'
}>

type FoundationOptions = RailwayFoundationGraphTarget &
  Readonly<{
    mode: 'plan' | 'apply' | 'verify'
    planPath: string
    planSha256?: string
  }>

type FoundationPlanEvidence = Readonly<{
  bytes: Buffer
  sha256: string
  changes: readonly JsonRecord[]
  configEtag: string
}>

function flagValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : undefined
  return value?.startsWith('--') ? undefined : value
}

function requiredFlag(args: readonly string[], name: string): string {
  const value = flagValue(args, name)?.trim()
  if (!value) throw new Error(`${name} is required`)
  if (value.length > 255) throw new Error(`${name} is too long`)
  return value
}

function expectedProjectName(profile: RailwayDeploymentProfile): string {
  return profile === 'production'
    ? PRODUCTION_RAILWAY_PROJECT_NAME
    : REHEARSAL_RAILWAY_PROJECT_NAME
}

function parseOptions(args: readonly string[]): FoundationOptions {
  const mode = args[0]
  if (mode !== 'plan' && mode !== 'apply' && mode !== 'verify') {
    throw new Error('first argument must be plan, apply, or verify')
  }
  const cell = flagValue(args, '--cell')
  if (!cell || !isBetaDeploymentDataCellId(cell)) {
    throw new Error(`--cell must be ${BETA_DEPLOYMENT_DATA_CELL_IDS.join(', ')}`)
  }
  const deploymentProfile = requireRailwayDeploymentProfile(
    flagValue(args, '--deployment-profile'),
  )
  const planSha256 = flagValue(args, '--plan-sha256')
  if (mode !== 'plan' && (!planSha256 || !SHA256.test(planSha256))) {
    throw new Error('--plan-sha256 must be the reviewed lowercase sha256')
  }
  return Object.freeze({
    mode,
    deploymentProfile,
    projectId: requiredFlag(args, '--project-id'),
    projectName: expectedProjectName(deploymentProfile),
    environmentId: requiredFlag(args, '--environment-id'),
    environmentName: `cell-${cell}`,
    planPath: resolve(requiredFlag(args, '--plan')),
    ...(planSha256 ? { planSha256 } : {}),
  })
}

function defaultRailwayExecutor(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): RailwayFoundationCommandResult {
  const result = spawnSync('railway', [...args], {
    encoding: 'utf8',
    env: environment,
  })
  return Object.freeze({
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  })
}

function railwayCommand(
  railway: RailwayFoundationExecutor,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  acceptedStatuses: readonly number[] = [0],
): RailwayFoundationCommandResult {
  const result = railway(args, environment)
  if (result.error) throw result.error
  if (!acceptedStatuses.includes(result.status)) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `railway ${args.join(' ')} exited ${String(result.status)}`,
    )
  }
  return result
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortedJson(child)]),
    )
  }
  return value
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortedJson(value))
}

function assertExactKeys(
  value: JsonRecord,
  expected: readonly string[],
  label: string,
): void {
  if (!isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())) {
    throw new Error(`${label} has unexpected fields`)
  }
}

function expectedFoundationGraph(options: RailwayFoundationGraphTarget): Readonly<{
  name: string
  resources: readonly JsonRecord[]
}> {
  const definition = buildRailwayProject(
    createRailwayContext({
      projectName: options.projectName,
      environmentName: options.environmentName,
    }),
    options.environmentName,
    options.deploymentProfile,
    RAILWAY_FOUNDATION_SOURCE_INPUT,
    options.projectName,
  )
  const graph = record(
    JSON.parse(JSON.stringify(definition)) as unknown,
    'expected Railway foundation graph',
  )
  const resources = array(
    graph.resources,
    'expected Railway foundation graph resources',
  ).map((resource, index) =>
    record(resource, `expected Railway foundation resource[${String(index)}]`),
  )
  const graphSha256 = createHash('sha256').update(stableJson(graph)).digest('hex')
  if (graphSha256 !== FOUNDATION_GRAPH_SHA256_BY_PROFILE[options.deploymentProfile]) {
    throw new Error(
      `Railway ${options.deploymentProfile} foundation graph changed; review and explicitly update its pinned contract digest`,
    )
  }
  if (graph.name !== options.projectName || resources.length !== 16) {
    throw new Error('Railway foundation graph does not match the pinned project contract')
  }
  const addresses = resources.map((resource) => resource.address)
  if (
    addresses.some((address) => typeof address !== 'string') ||
    new Set(addresses).size !== addresses.length
  ) {
    throw new Error('Railway foundation graph contains invalid resource addresses')
  }
  for (const resource of resources.filter((candidate) => candidate.type === 'service')) {
    if (
      resource.kind !== 'empty' ||
      Object.hasOwn(resource, 'source') ||
      Object.hasOwn(resource, 'build')
    ) {
      throw new Error('Railway foundation graph contains a runnable service source')
    }
  }
  return Object.freeze({
    name: options.projectName,
    resources: Object.freeze(resources),
  })
}

function expectedFoundationChanges(options: FoundationOptions): readonly JsonRecord[] {
  return Object.freeze(
    expectedFoundationGraph(options).resources.map((resource) => {
      const address = String(resource.address)
      const type = String(resource.type)
      const name = String(resource.name)
      return Object.freeze({
        kind: 'resource.create',
        address,
        resource,
        path: `resources.${address}`,
        summary: `Create ${type} ${name}`,
        severity: 'safe',
        deployEffect: type === 'service' || type === 'database' ? 'deploy' : 'none',
      })
    }),
  )
}

// The reviewed plan is read through one path resolution, so the inode whose
// bytes are hashed is the inode that passed the regular-file guard. That sha256
// is exactly what `assertReviewedPlanUnchanged` compares against the reviewed
// digest before apply. `readOnce` documents what this does and does not
// contain.
const PLAN_NOT_REGULAR = 'Railway foundation plan must be a regular file'

function parseFoundationPlan(
  planPath: string,
  options: FoundationOptions,
): FoundationPlanEvidence {
  const bytes = readOnce(planPath, PLAN_NOT_REGULAR)
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('Railway foundation plan is not valid JSON')
  }
  const plan = record(value, 'Railway foundation plan')
  assertExactKeys(
    plan,
    [
      'kind',
      'version',
      'cliVersion',
      'sourceTree',
      'environmentId',
      'configEtag',
      'changeSetHash',
      'changeSet',
      'diff',
      'destructive',
    ],
    'Railway foundation plan',
  )
  if (
    plan.kind !== 'railway.config.plan' ||
    plan.version !== 1 ||
    plan.cliVersion !== MINIMUM_PINNED_PLAN_RAILWAY_CLI_VERSION ||
    plan.environmentId !== options.environmentId
  ) {
    throw new Error('Railway foundation plan does not target the reviewed environment')
  }
  if (
    plan.sourceTree !== railwaySavedPlanSourceTree() ||
    typeof plan.configEtag !== 'string' ||
    plan.configEtag.trim() === '' ||
    typeof plan.diff !== 'string'
  ) {
    throw new Error('Railway foundation plan omitted pinned revision metadata')
  }
  if (plan.destructive !== false) {
    throw new Error('Railway foundation plan must contain only non-destructive changes')
  }
  const changeSet = record(plan.changeSet, 'Railway foundation plan changeSet')
  assertExactKeys(
    changeSet,
    ['version', 'changes', 'diagnostics', 'declared', 'telemetry'],
    'Railway foundation plan changeSet',
  )
  const expectedChanges = expectedFoundationChanges(options)
  const changes = array(changeSet.changes, 'Railway foundation plan changes').map(
    (change, index) => {
      const parsed = record(change, `Railway foundation plan change[${String(index)}]`)
      assertExactKeys(
        parsed,
        ['kind', 'address', 'resource', 'path', 'summary', 'severity', 'deployEffect'],
        `Railway foundation plan change[${String(index)}]`,
      )
      return parsed
    },
  )
  const diagnostics = array(changeSet.diagnostics, 'Railway foundation plan diagnostics')
  const declared = array(changeSet.declared, 'Railway foundation plan declared resources')
  const telemetry = record(changeSet.telemetry, 'Railway foundation plan telemetry')
  if (
    changeSet.version !== 1 ||
    diagnostics.length !== 0 ||
    !isDeepStrictEqual(changes, expectedChanges) ||
    !isDeepStrictEqual(
      declared,
      expectedChanges.map((change) => change.address),
    ) ||
    !isDeepStrictEqual(telemetry, { language: 'typescript' })
  ) {
    throw new Error(
      'Railway foundation plan is not the exact reviewed source-less foundation graph',
    )
  }
  const expectedDiff = expectedChanges
    .map((change) => `+ ${String(change.summary)}`)
    .join('\n')
  if (plan.diff !== expectedDiff) {
    throw new Error('Railway foundation plan diff does not match its exact create set')
  }
  if (
    typeof plan.changeSetHash !== 'string' ||
    !SAVED_CHANGE_SET_SHA256.test(plan.changeSetHash) ||
    plan.changeSetHash !==
      `sha256:${createHash('sha256').update(stableJson(changeSet)).digest('hex')}`
  ) {
    throw new Error('Railway foundation plan change-set hash is invalid')
  }
  return Object.freeze({
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    changes: Object.freeze(changes),
    configEtag: plan.configEtag,
  })
}

function assertReviewedPlanUnchanged(options: FoundationOptions): FoundationPlanEvidence {
  const evidence = parseFoundationPlan(options.planPath, options)
  if (evidence.sha256 !== options.planSha256) {
    throw new Error('Railway foundation plan changed after review')
  }
  return evidence
}

const FOUNDATION_PLAN_KEYS = [
  'ok',
  'command',
  'file',
  'currentEnvironment',
  'changeSet',
  'diff',
  'diagnostics',
  'currentGraph',
  'desiredGraph',
  'stagedPatch',
  'applyResult',
  'deploymentId',
  'stagedPatchId',
] as const

/**
 * The envelope must be a clean `plan` of the tracked IaC file against exactly
 * the reviewed project, environment, and config etag — with nothing staged,
 * applied, or deployed.
 */
function assertFoundationPlanEnvelope(
  plan: JsonRecord,
  options: FoundationOptions,
  evidence: FoundationPlanEvidence,
): void {
  assertExactKeys(plan, FOUNDATION_PLAN_KEYS, 'Railway foundation plan output')
  const current = record(
    plan.currentEnvironment,
    'Railway foundation plan currentEnvironment',
  )
  assertExactKeys(
    current,
    ['projectId', 'projectName', 'environmentId', 'environmentName', 'configEtag'],
    'Railway foundation plan currentEnvironment',
  )
  if (
    plan.ok !== true ||
    plan.command !== 'plan' ||
    resolve(String(plan.file)) !== resolve(IAC_FILE) ||
    current.projectId !== options.projectId ||
    current.projectName !== options.projectName ||
    current.environmentId !== options.environmentId ||
    current.environmentName !== options.environmentName ||
    current.configEtag !== evidence.configEtag ||
    plan.stagedPatch !== null ||
    plan.applyResult !== null ||
    plan.deploymentId !== null ||
    plan.stagedPatchId !== null
  ) {
    throw new Error('Railway foundation plan output targets the wrong project')
  }
  if (
    array(plan.diagnostics, 'Railway foundation plan output diagnostics').length !== 0
  ) {
    throw new Error('Railway foundation plan output reported diagnostics')
  }
}

/** The foundation may only ever be laid on a project that holds no resources. */
function assertBlankCurrentGraph(plan: JsonRecord, options: FoundationOptions): void {
  const currentGraph = record(plan.currentGraph, 'Railway foundation plan currentGraph')
  const currentProject = record(
    currentGraph.project,
    'Railway foundation plan currentGraph.project',
  )
  if (
    currentProject.name !== options.projectName ||
    array(currentGraph.resources, 'Railway foundation plan currentGraph.resources')
      .length !== 0
  ) {
    throw new Error('Railway foundation plan did not observe a blank project')
  }
}

/**
 * The desired graph must be exactly the expected foundation, and no service in
 * it may carry a source — the foundation creates shells, never runnable code.
 */
function assertDesiredFoundationGraph(
  plan: JsonRecord,
  options: FoundationOptions,
): void {
  const desiredGraph = record(plan.desiredGraph, 'Railway foundation plan desiredGraph')
  const desiredProject = record(
    desiredGraph.project,
    'Railway foundation plan desiredGraph.project',
  )
  const desiredResources = array(
    desiredGraph.resources,
    'Railway foundation plan desiredGraph.resources',
  ).map((resource, index) =>
    record(resource, `Railway foundation displayed resource[${String(index)}]`),
  )
  const expectedResources = expectedFoundationGraph(options).resources
  if (
    desiredProject.name !== options.projectName ||
    !isDeepStrictEqual(
      desiredResources.map(({ address, type, name }) => ({ address, type, name })),
      expectedResources.map(({ address, type, name }) => ({ address, type, name })),
    )
  ) {
    throw new Error('Railway foundation plan output omitted the expected desired graph')
  }
  for (const service of desiredResources.filter(
    (resource) => resource.type === 'service',
  )) {
    if (service.source !== null && service.source !== undefined) {
      throw new Error('Railway foundation plan output contains a runnable source')
    }
  }
}

/** The displayed change set and diff must project exactly from the saved plan. */
function assertDisplayedChangeSet(
  plan: JsonRecord,
  evidence: FoundationPlanEvidence,
): void {
  const displayedChangeSet = record(
    plan.changeSet,
    'Railway foundation displayed changeSet',
  )
  assertExactKeys(
    displayedChangeSet,
    ['changes'],
    'Railway foundation displayed changeSet',
  )
  const displayedChanges = array(
    displayedChangeSet.changes,
    'Railway foundation displayed changes',
  )
  const projectedSavedChanges = evidence.changes.map((change) => ({
    summary: change.summary,
    severity: change.severity,
    kind: change.kind,
    details: null,
  }))
  if (
    !isDeepStrictEqual(displayedChanges, projectedSavedChanges) ||
    plan.diff !== projectedSavedChanges.map((change) => `+ ${change.summary}`).join('\n')
  ) {
    throw new Error('Railway foundation displayed plan does not match the saved plan')
  }
}

function parseFoundationPlanOutput(
  output: string,
  options: FoundationOptions,
  evidence: FoundationPlanEvidence,
): void {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error('Railway foundation plan output is not valid JSON')
  }
  const plan = record(value, 'Railway foundation plan output')
  assertFoundationPlanEnvelope(plan, options, evidence)
  assertBlankCurrentGraph(plan, options)
  assertDesiredFoundationGraph(plan, options)
  assertDisplayedChangeSet(plan, evidence)
}

function runnerResourceProjection(resource: JsonRecord): JsonRecord {
  return Object.freeze({
    address: resource.address ?? null,
    type: resource.type,
    name: resource.name,
    engine: resource.engine ?? null,
    variables: resource.variables ?? null,
    source: resource.source ?? null,
    build: resource.build ?? null,
    deploy: resource.deploy ?? null,
    networking: resource.networking ?? null,
    volumeAttachments: resource.volumeAttachments ?? null,
    config: resource.config ?? null,
    groupId: resource.groupId ?? null,
  })
}

export function assertSingleUsBetaRailwayFoundationNoDriftOutput(
  output: string,
  options: RailwayFoundationGraphTarget,
): void {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error('Railway foundation verification plan is not valid JSON')
  }
  const plan = record(value, 'Railway foundation verification plan')
  const current = record(
    plan.currentEnvironment,
    'Railway foundation verification currentEnvironment',
  )
  const changeSet = record(plan.changeSet, 'Railway foundation verification changeSet')
  const currentGraph = record(
    plan.currentGraph,
    'Railway foundation verification currentGraph',
  )
  const desiredGraph = record(
    plan.desiredGraph,
    'Railway foundation verification desiredGraph',
  )
  const expected = expectedFoundationGraph(options)
  const expectedResources = expected.resources.map(runnerResourceProjection)
  const currentResources = array(
    currentGraph.resources,
    'Railway foundation verification current resources',
  ).map((resource, index) =>
    runnerResourceProjection(
      record(resource, `Railway foundation current resource[${String(index)}]`),
    ),
  )
  const desiredResources = array(
    desiredGraph.resources,
    'Railway foundation verification desired resources',
  ).map((resource, index) =>
    runnerResourceProjection(
      record(resource, `Railway foundation desired resource[${String(index)}]`),
    ),
  )
  const byAddress = (left: JsonRecord, right: JsonRecord): number =>
    String(left.address).localeCompare(String(right.address))
  const expectedIdentities = expectedResources
    .map(({ address, type, name }) => ({ address, type, name }))
    .sort(byAddress)
  if (
    plan.ok !== true ||
    plan.command !== 'plan' ||
    resolve(String(plan.file)) !== resolve(IAC_FILE) ||
    current.projectId !== options.projectId ||
    current.projectName !== options.projectName ||
    current.environmentId !== options.environmentId ||
    current.environmentName !== options.environmentName ||
    array(plan.diagnostics, 'Railway foundation verification diagnostics').length !== 0 ||
    array(changeSet.changes, 'Railway foundation verification changes').length !== 0 ||
    plan.diff !== 'No changes.' ||
    !isDeepStrictEqual(desiredResources, expectedResources) ||
    !isDeepStrictEqual(
      currentResources
        .map(({ address, type, name }) => ({ address, type, name }))
        .sort(byAddress),
      expectedIdentities,
    )
  ) {
    throw new Error(
      'Railway foundation verification did not prove the exact frozen graph at no drift',
    )
  }
}

function assertFoundationTarget(
  railway: RailwayFoundationExecutor,
  options: FoundationOptions,
  environment: NodeJS.ProcessEnv,
): void {
  const status = railwayCommand(railway, railwayFullProjectStatusArgs(), environment)
  assertSingleUsBetaRailwayFoundationIsolation(
    parseRailwayProjectServiceInventory(status.stdout),
    {
      projectId: options.projectId,
      projectName: options.projectName,
      environmentId: options.environmentId,
      environmentName: options.environmentName,
    },
  )
}

function assertFoundationReadback(
  railway: RailwayFoundationExecutor,
  options: FoundationOptions,
  environment: NodeJS.ProcessEnv,
): void {
  const status = railwayCommand(railway, railwayFullProjectStatusArgs(), environment)
  assertSingleUsBetaRailwayFoundationReadback(
    parseRailwayProjectServiceInventory(status.stdout),
    {
      projectId: options.projectId,
      projectName: options.projectName,
      environmentId: options.environmentId,
      environmentName: options.environmentName,
    },
  )
}

function assertFoundationApplyResult(
  output: string,
  expectedChanges: readonly JsonRecord[],
): void {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error('Railway foundation apply output is not valid JSON')
  }
  const result = record(value, 'Railway foundation apply output')
  if (result.status !== 'complete') {
    throw new Error(`Railway foundation apply ended ${String(result.status)}`)
  }
  if (array(result.diagnostics, 'Railway foundation apply diagnostics').length !== 0) {
    throw new Error('Railway foundation apply reported diagnostics')
  }
  const changes = array(result.changes, 'Railway foundation apply changes')
  if (changes.length !== expectedChanges.length) {
    throw new Error('Railway foundation apply did not report every reviewed change')
  }
  const unmatched = [...changes]
  for (const expected of expectedChanges) {
    const index = unmatched.findIndex((value) => {
      const change = record(value, 'Railway foundation apply change')
      return change.kind === expected.kind && change.path === expected.path
    })
    if (index < 0) {
      throw new Error(`Railway foundation apply omitted ${String(expected.path)}`)
    }
    const applied = record(
      unmatched.splice(index, 1)[0],
      'Railway foundation apply change',
    )
    if (applied.status !== 'applied') {
      throw new Error(`Railway foundation apply did not apply ${String(expected.path)}`)
    }
  }
}

function assertExactFoundationRailwayCliVersion(output: string): void {
  assertRailwayCliSupportsPinnedPlans(output)
  const observed = /\b(\d+\.\d+\.\d+)\b/u.exec(output)?.[1]
  if (observed !== MINIMUM_PINNED_PLAN_RAILWAY_CLI_VERSION) {
    throw new Error(
      `Railway foundation is pinned to CLI ${MINIMUM_PINNED_PLAN_RAILWAY_CLI_VERSION}; observed ${observed ?? 'unknown'}`,
    )
  }
}

export function runRailwayDataCellFoundationCli(
  args: readonly string[],
  dependencies: Readonly<{ railway?: RailwayFoundationExecutor }> = {},
): number {
  try {
    const options = parseOptions(args)
    const railway = dependencies.railway ?? defaultRailwayExecutor
    if (options.mode === 'plan' && existsSync(options.planPath)) {
      throw new Error('Railway foundation plan path already exists')
    }
    if (options.mode !== 'plan') assertReviewedPlanUnchanged(options)

    const environment = {
      ...railwayTargetEnvironment({
        project: options.projectId,
        name: options.projectName,
        environment: options.environmentId,
      }),
      RAILWAY_CALLER: process.env.RAILWAY_CALLER ?? 'repo:railway-data-cell-foundation',
      RAILWAY_AGENT_SESSION:
        process.env.RAILWAY_AGENT_SESSION ??
        `repkey-foundation-${options.deploymentProfile}-us`,
      REPKEY_RAILWAY_CELL_ENVIRONMENT: options.environmentName,
      REPKEY_RAILWAY_DEPLOYMENT_PROFILE: options.deploymentProfile,
      [RAILWAY_SERVICE_SOURCE_MAP_ENV]: CANONICAL_RAILWAY_FOUNDATION_SOURCE_INPUT,
    }
    assertRailwayFullProjectVisibilityCredential(environment)

    const version = railwayCommand(railway, ['--version'], environment)
    assertExactFoundationRailwayCliVersion(`${version.stdout}\n${version.stderr}`)
    if (options.mode === 'verify') {
      assertFoundationReadback(railway, options, environment)
      const noDrift = railwayCommand(
        railway,
        railwayPlanArgs({ iacFile: IAC_FILE }),
        environment,
      )
      assertSingleUsBetaRailwayFoundationNoDriftOutput(noDrift.stdout, options)
      process.stderr.write(
        `Foundation readback verified for ${options.projectName}/${options.environmentName} after the reviewed plan.\n`,
      )
      return 0
    }
    assertFoundationTarget(railway, options, environment)

    if (options.mode === 'plan') {
      const plan = railwayCommand(
        railway,
        railwayPinnedPlanArgs(options.planPath, IAC_FILE),
        environment,
        [0, 2],
      )
      if (plan.status !== 2) {
        throw new Error('Railway foundation plan must contain the 16 reviewed creates')
      }
      const evidence = parseFoundationPlan(options.planPath, options)
      parseFoundationPlanOutput(plan.stdout, options, evidence)
      if (plan.stdout) process.stdout.write(plan.stdout)
      process.stderr.write(
        `Foundation plan retained at ${options.planPath}; sha256=${evidence.sha256}. Review these exact non-destructive changes before apply.\n`,
      )
      return 0
    }

    // Re-read both the live project and reviewed bytes immediately before the
    // only mutation. The saved-plan apply itself also rejects remote drift.
    const evidence = assertReviewedPlanUnchanged(options)
    const applied = railwayCommand(
      railway,
      railwayPinnedApplyArgs(options.planPath),
      environment,
    )
    assertFoundationApplyResult(applied.stdout, evidence.changes)
    assertFoundationReadback(railway, options, environment)
    const noDrift = railwayCommand(
      railway,
      railwayPlanArgs({ iacFile: IAC_FILE }),
      environment,
    )
    assertSingleUsBetaRailwayFoundationNoDriftOutput(noDrift.stdout, options)
    if (applied.stdout) process.stdout.write(applied.stdout)
    process.stderr.write(
      `Foundation apply completed and exact no-drift readback verified for ${options.projectName}/${options.environmentName}.\n`,
    )
    return 0
  } catch (error) {
    process.stderr.write(
      `Railway Data Cell foundation refused: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runRailwayDataCellFoundationCli(process.argv.slice(2))
}
