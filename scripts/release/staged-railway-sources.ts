import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
  canonicalRailwayServiceSourceInput,
  parseRailwayServiceSourceInput,
  RAILWAY_SERVICE_SOURCE_MAP_VERSION,
  RAILWAY_SOURCE_MANAGED_SERVICES,
  type RailwayServiceSourceInput,
  type RailwayServiceSourceMap,
  type RailwaySourceManagedService,
} from '../../.railway/service-source-map'
import {
  array,
  record,
  type JsonRecord,
} from '../../src/shared/release/json-shape-guards'
import {
  RAILWAY_SERVICE_IMAGE_ROLES,
  promotedImageReference,
  type PromotionManifest,
  type RailwayApplicationService,
} from '../../src/shared/release/promotion-manifest'
import { readOnce } from '../../src/shared/release/read-once'

export const MINIMUM_PINNED_PLAN_RAILWAY_CLI_VERSION = '5.45.2' as const

export type RailwayIacTarget = Readonly<{
  projectId: string
  projectName: string
  environmentId: string
  environment: string
}>

export type StagedPlanDisposition = 'change' | 'noop'

function parseJson(output: string, label: string): JsonRecord {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  return record(value, label)
}

function parseVersion(output: string): readonly [number, number, number] {
  const match = /\b(\d+)\.(\d+)\.(\d+)\b/u.exec(output)
  if (!match) throw new Error('could not determine Railway CLI version')
  const version = match.slice(1).map(Number)
  return [version[0] ?? 0, version[1] ?? 0, version[2] ?? 0]
}

function compareVersion(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

export function assertRailwayCliSupportsPinnedPlans(output: string): void {
  const minimum = parseVersion(MINIMUM_PINNED_PLAN_RAILWAY_CLI_VERSION)
  const observed = parseVersion(output)
  if (compareVersion(observed, minimum) < 0) {
    throw new Error(
      `Railway CLI ${MINIMUM_PINNED_PLAN_RAILWAY_CLI_VERSION} or newer is required for pinned plan/apply`,
    )
  }
}

/**
 * Reproduce Railway CLI 5.45.2's saved-plan source-tree identity.
 *
 * A clean checked-in `.railway` directory is represented by its Git tree ID.
 * A dirty tree is represented by a byte-for-byte SHA-256 over every file under
 * `.railway`, matching Railway's fallback ordering and separators.
 */
export function railwaySavedPlanSourceTree(root = process.cwd()): string {
  const status = spawnSync('git', ['status', '--porcelain', '--', '.railway'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (status.status === 0 && status.stdout === '') {
    const tree = spawnSync('git', ['rev-parse', 'HEAD:.railway'], {
      cwd: root,
      encoding: 'utf8',
    })
    const value = tree.status === 0 ? tree.stdout.trim() : ''
    if (value) return value
  }

  const railwayRoot = resolve(root, '.railway')
  const files: Array<Readonly<{ relativePath: string; absolutePath: string }>> = []
  const collect = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      if (entry.name === '.DS_Store') continue
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        collect(absolutePath)
      } else {
        files.push({
          relativePath: relative(railwayRoot, absolutePath).replaceAll('\\', '/'),
          absolutePath,
        })
      }
    }
  }
  collect(railwayRoot)
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))

  const digest = createHash('sha256')
  for (const file of files) {
    digest.update(file.relativePath)
    digest.update(Buffer.from([0]))
    digest.update(readFileSync(file.absolutePath))
    digest.update(Buffer.from([0]))
  }
  return `sha256:${digest.digest('hex')}`
}

export function fullRailwayServiceSourceInput(
  manifest: PromotionManifest,
): RailwayServiceSourceInput {
  const applicationSources = Object.fromEntries(
    (Object.keys(RAILWAY_SERVICE_IMAGE_ROLES) as RailwayApplicationService[]).map(
      (serviceName) => [serviceName, promotedImageReference(manifest, serviceName)],
    ),
  ) as Readonly<Record<RailwayApplicationService, string>>
  const input = Object.freeze({
    version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
    stage: 'promotion',
    sources: Object.freeze({
      'schema-migrator': promotedImageReference(manifest, 'web'),
      ...applicationSources,
    }),
  })
  return parseRailwayServiceSourceInput(canonicalRailwayServiceSourceInput(input))
}

export function stagedRailwayServiceSourceInput(
  current: RailwayServiceSourceMap,
  candidate: RailwayServiceSourceInput,
  serviceName: RailwaySourceManagedService,
): RailwayServiceSourceInput {
  const candidateReference = candidate.sources[serviceName]
  if (!candidateReference) {
    throw new Error(`candidate source map does not contain ${serviceName}`)
  }
  const sources = Object.fromEntries(
    RAILWAY_SOURCE_MANAGED_SERVICES.flatMap((name) => {
      const reference = name === serviceName ? candidateReference : current[name]
      return reference === undefined ? [] : [[name, reference]]
    }),
  ) as RailwayServiceSourceMap
  const input = Object.freeze({
    version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
    stage: 'promotion',
    sources: Object.freeze(sources),
  })
  return parseRailwayServiceSourceInput(canonicalRailwayServiceSourceInput(input))
}

export function railwaySourceMapEnvironment(input: RailwayServiceSourceInput): string {
  return canonicalRailwayServiceSourceInput(input)
}

export function railwayPinnedPlanArgs(
  outputPath: string,
  iacFile = '.railway/railway.ts',
): readonly string[] {
  return Object.freeze([
    'config',
    'plan',
    '--file',
    iacFile,
    '--out',
    outputPath,
    '--detailed-exit-code',
    '--json',
  ])
}

export function railwayPinnedApplyArgs(planPath: string): readonly string[] {
  return Object.freeze(['config', 'apply', '--plan', planPath, '--yes', '--json'])
}

function planTarget(plan: JsonRecord): RailwayIacTarget {
  const current = record(plan.currentEnvironment, 'Railway plan currentEnvironment')
  const value = (name: string): string => {
    const found = current[name]
    if (typeof found !== 'string' || found.trim() === '') {
      throw new Error(`Railway plan currentEnvironment.${name} is required`)
    }
    return found
  }
  return {
    projectId: value('projectId'),
    projectName: value('projectName'),
    environmentId: value('environmentId'),
    environment: value('environmentName'),
  }
}

function assertTarget(observed: RailwayIacTarget, expected: RailwayIacTarget): void {
  for (const key of [
    'projectId',
    'projectName',
    'environmentId',
    'environment',
  ] as const) {
    if (observed[key] !== expected[key]) {
      throw new Error(
        `Railway plan target ${key}=${observed[key]} does not match reviewed ${expected[key]}`,
      )
    }
  }
}

function graphResources(plan: JsonRecord, key: 'currentGraph' | 'desiredGraph') {
  const graph = record(plan[key], `Railway plan ${key}`)
  return array(graph.resources, `Railway plan ${key}.resources`).map((value, index) =>
    record(value, `Railway plan ${key}.resources[${String(index)}]`),
  )
}

function graphServiceSource(
  plan: JsonRecord,
  key: 'currentGraph' | 'desiredGraph',
  serviceName: RailwaySourceManagedService,
): unknown {
  const matches = graphResources(plan, key).filter(
    (resource) => resource.address === `service.${serviceName}`,
  )
  if (matches.length !== 1) {
    throw new Error(`Railway plan ${key} must contain exactly one service.${serviceName}`)
  }
  return matches[0]?.source ?? null
}

function graphSourceMap(
  plan: JsonRecord,
  key: 'currentGraph' | 'desiredGraph',
): RailwayServiceSourceMap {
  const resources = graphResources(plan, key)
  const sources: Partial<Record<RailwaySourceManagedService, string>> = {}
  for (const serviceName of RAILWAY_SOURCE_MANAGED_SERVICES) {
    const matches = resources.filter(
      (resource) => resource.address === `service.${serviceName}`,
    )
    if (matches.length !== 1) {
      throw new Error(
        `Railway plan ${key} must contain exactly one service.${serviceName}`,
      )
    }
    const sourceValue = matches[0]?.source
    if (sourceValue === undefined || sourceValue === null) continue
    const source = record(sourceValue, `Railway plan ${key} ${serviceName} source`)
    if (
      typeof source.image !== 'string' ||
      source.repo !== undefined ||
      (source.type !== undefined && source.type !== 'image')
    ) {
      throw new Error(
        `Railway plan ${key} ${serviceName} must use only an immutable image source`,
      )
    }
    sources[serviceName] = source.image
  }
  // Reuse the graph contract's exact registry/digest validation. An entirely
  // empty current graph is the one legitimate pre-promotion state.
  if (Object.keys(sources).length > 0) {
    parseRailwayServiceSourceInput(
      canonicalRailwayServiceSourceInput({
        version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
        stage: 'promotion',
        sources,
      }),
    )
  }
  return Object.freeze(sources)
}

function assertSourceMapsEqual(
  observed: RailwayServiceSourceMap,
  expected: RailwayServiceSourceMap,
  label: string,
): void {
  for (const serviceName of RAILWAY_SOURCE_MANAGED_SERVICES) {
    if (observed[serviceName] !== expected[serviceName]) {
      throw new Error(
        `${label} ${serviceName}=${observed[serviceName] ?? '(empty)'} does not match ${expected[serviceName] ?? '(empty)'}`,
      )
    }
  }
}

function validatedPlan(output: string, expectedTarget: RailwayIacTarget): JsonRecord {
  const plan = parseJson(output, 'Railway IaC plan output')
  if (plan.ok !== true) throw new Error('Railway IaC plan was not successful')
  assertTarget(planTarget(plan), expectedTarget)
  const diagnostics = array(plan.diagnostics, 'Railway plan diagnostics')
  const blocking = diagnostics.find((value) => {
    const diagnostic = record(value, 'Railway plan diagnostic')
    return diagnostic.severity === 'error'
  })
  if (blocking) throw new Error('Railway IaC plan contains a blocking diagnostic')
  return plan
}

export function inspectFullCandidateRailwayPlan(
  output: string,
  expectedTarget: RailwayIacTarget,
  candidate: RailwayServiceSourceInput,
): Readonly<{
  currentSources: RailwayServiceSourceMap
  rawSha256: string
  changeCount: number
}> {
  const plan = validatedPlan(output, expectedTarget)
  const desiredSources = graphSourceMap(plan, 'desiredGraph')
  assertSourceMapsEqual(desiredSources, candidate.sources, 'desired source')
  const currentSources = graphSourceMap(plan, 'currentGraph')
  const changeSet = record(plan.changeSet, 'Railway plan changeSet')
  const changes = array(changeSet.changes, 'Railway plan changeSet.changes')
  const expectedChangedServices = RAILWAY_SOURCE_MANAGED_SERVICES.filter(
    (serviceName) => currentSources[serviceName] !== candidate.sources[serviceName],
  )
  if (changes.length !== expectedChangedServices.length) {
    throw new Error(
      `Railway full-candidate plan has ${String(changes.length)} changes for ${String(expectedChangedServices.length)} source differences`,
    )
  }
  const unmatched = [...changes]
  for (const serviceName of expectedChangedServices) {
    const index = unmatched.findIndex((value) => {
      const change = record(value, 'Railway full-candidate change')
      return (
        typeof change.summary === 'string' &&
        change.summary.startsWith(`Update ${serviceName} source`)
      )
    })
    if (index < 0) {
      throw new Error(
        `Railway full-candidate plan omitted the ${serviceName} source update`,
      )
    }
    assertDisplayedSourceChange(
      unmatched.splice(index, 1)[0],
      serviceName,
      'Railway full-candidate',
    )
  }
  if (unmatched.length !== 0) {
    throw new Error('Railway full-candidate plan contains an unrelated graph change')
  }
  return Object.freeze({
    currentSources,
    rawSha256: createHash('sha256').update(output).digest('hex'),
    changeCount: changes.length,
  })
}

function assertDisplayedSourceChange(
  changeValue: unknown,
  serviceName: RailwaySourceManagedService,
  label: string,
): void {
  const change = record(changeValue, `${label} source change`)
  // Railway 5.45.2 writes the complete raw change to --out, but its public
  // RunnerResponse intentionally serializes only these review-safe fields.
  const expectedKeys = ['details', 'kind', 'severity', 'summary']
  const observedKeys = Object.keys(change).sort()
  const summary = change.summary
  const details = change.details
  if (
    !isDeepStrictEqual(observedKeys, expectedKeys) ||
    change.kind !== 'resource.update' ||
    change.severity !== 'safe' ||
    typeof summary !== 'string' ||
    !summary.startsWith(`Update ${serviceName} source`) ||
    !Array.isArray(details) ||
    details.length === 0 ||
    details.some((detail) => typeof detail !== 'string' || !detail.startsWith('source.'))
  ) {
    throw new Error(`${label} contains an unexpected ${serviceName} change`)
  }
}

export function inspectStagedRailwayPlan(
  output: string,
  expectedTarget: RailwayIacTarget,
  current: RailwayServiceSourceMap,
  desired: RailwayServiceSourceInput,
  serviceName: RailwaySourceManagedService,
): StagedPlanDisposition {
  const plan = validatedPlan(output, expectedTarget)
  assertSourceMapsEqual(graphSourceMap(plan, 'currentGraph'), current, 'current source')
  assertSourceMapsEqual(
    graphSourceMap(plan, 'desiredGraph'),
    desired.sources,
    'desired source',
  )
  const changeSet = record(plan.changeSet, 'Railway plan changeSet')
  const changes = array(changeSet.changes, 'Railway plan changeSet.changes')
  if (current[serviceName] === desired.sources[serviceName]) {
    if (changes.length !== 0) {
      throw new Error(
        `Railway staged plan for unchanged ${serviceName} contains unexpected changes`,
      )
    }
    return 'noop'
  }
  if (changes.length !== 1) {
    throw new Error(
      `Railway staged plan for ${serviceName} must contain exactly one source update`,
    )
  }
  assertDisplayedSourceChange(changes[0], serviceName, 'Railway staged plan')
  return 'change'
}

function sourceSupportsAutoUpdates(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const source = value as Readonly<Record<string, unknown>>
  if (source.type !== 'image' || typeof source.image !== 'string') return false
  const image = source.image.trim().toLowerCase()
  if (image === '') return false
  if (!image.includes('/')) return true
  const registry = image.split('/')[0] ?? ''
  return (
    (!registry.includes('.') && !registry.includes(':') && registry !== 'localhost') ||
    registry === 'docker.io' ||
    registry === 'ghcr.io'
  )
}

function withoutAutoUpdates(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const source = { ...(value as Readonly<Record<string, unknown>>) }
  delete source.autoUpdates
  return Object.keys(source).length === 0 ? null : source
}

function assertSavedSourceChange(
  savedChangeValue: unknown,
  displayedChangeValue: unknown,
  plan: JsonRecord,
  serviceName: RailwaySourceManagedService,
): void {
  const savedChange = record(savedChangeValue, 'Railway saved source change')
  const displayedChange = record(displayedChangeValue, 'Railway displayed source change')
  const expectedKeys = [
    'address',
    'after',
    'before',
    'deployEffect',
    'details',
    'field',
    'kind',
    'path',
    'severity',
    'summary',
  ]
  const desiredSource = graphServiceSource(plan, 'desiredGraph', serviceName)
  const stripsAutoUpdates = !sourceSupportsAutoUpdates(desiredSource)
  const expectedBefore = stripsAutoUpdates
    ? withoutAutoUpdates(graphServiceSource(plan, 'currentGraph', serviceName))
    : graphServiceSource(plan, 'currentGraph', serviceName)
  const expectedAfter = stripsAutoUpdates
    ? withoutAutoUpdates(desiredSource)
    : desiredSource
  const displayedFields = Object.fromEntries(
    ['details', 'kind', 'severity', 'summary'].map((key) => [key, displayedChange[key]]),
  )
  const savedDisplayedFields = Object.fromEntries(
    ['details', 'kind', 'severity', 'summary'].map((key) => [key, savedChange[key]]),
  )
  if (
    !isDeepStrictEqual(Object.keys(savedChange).sort(), expectedKeys) ||
    savedChange.kind !== 'resource.update' ||
    savedChange.address !== `service.${serviceName}` ||
    savedChange.field !== 'source' ||
    !isDeepStrictEqual(savedChange.before, expectedBefore) ||
    !isDeepStrictEqual(savedChange.after, expectedAfter) ||
    savedChange.path !== `resources.service.${serviceName}.source` ||
    savedChange.severity !== 'safe' ||
    savedChange.deployEffect !== 'deploy' ||
    !isDeepStrictEqual(savedDisplayedFields, displayedFields)
  ) {
    throw new Error(
      `Railway saved plan contains an unexpected ${serviceName} source change`,
    )
  }
}

/**
 * Bind the CLI's saved apply artifact to the exact plan JSON that was inspected.
 * The returned byte digest must be checked again immediately before apply.
 */
export function bindRailwaySavedPlanArtifact(
  planPath: string,
  plannedOutput: string,
  expectedTarget: RailwayIacTarget,
  current: RailwayServiceSourceMap,
  desired: RailwayServiceSourceInput,
  serviceName: RailwaySourceManagedService,
): string {
  const bytes = readOnce(planPath, 'Railway saved plan must be a regular file')
  const saved = parseJson(bytes.toString('utf8'), 'Railway saved plan artifact')
  const disposition = inspectStagedRailwayPlan(
    plannedOutput,
    expectedTarget,
    current,
    desired,
    serviceName,
  )
  const planned = validatedPlan(plannedOutput, expectedTarget)
  const savedChangeSet = record(saved.changeSet, 'Railway saved plan changeSet')
  const displayedChangeSet = record(planned.changeSet, 'Railway plan changeSet')
  const savedChanges = array(savedChangeSet.changes, 'Railway saved plan changes')
  const displayedChanges = array(displayedChangeSet.changes, 'Railway plan changes')
  if (
    saved.kind !== 'railway.config.plan' ||
    saved.version !== 1 ||
    saved.environmentId !== expectedTarget.environmentId ||
    saved.destructive !== false ||
    savedChanges.length !== displayedChanges.length ||
    (disposition === 'change' && savedChanges.length !== 1) ||
    (disposition === 'noop' && savedChanges.length !== 0)
  ) {
    throw new Error('Railway saved plan artifact does not match the inspected safe plan')
  }
  if (disposition === 'change') {
    assertSavedSourceChange(savedChanges[0], displayedChanges[0], planned, serviceName)
  }
  return createHash('sha256').update(bytes).digest('hex')
}

// This is the apply-time digest check: it is the last thing standing between
// the artifact an operator inspected and the bytes Railway applies, so the
// inode it hashes must be the inode it guarded. A `lstatSync(planPath)`
// followed by `readFileSync(planPath)` resolved the path twice and could hash
// an inode the guard never saw — the failure mode this function exists to
// report.
export function assertRailwaySavedPlanArtifactUnchanged(
  planPath: string,
  expectedSha256: string,
): void {
  const bytes = readOnce(planPath, 'Railway saved plan must remain a regular file')
  const observed = createHash('sha256').update(bytes).digest('hex')
  if (observed !== expectedSha256) {
    throw new Error('Railway saved plan artifact changed between inspection and apply')
  }
}

export function assertPinnedRailwayApplyResult(
  output: string,
  serviceName: RailwaySourceManagedService,
): void {
  const result = parseJson(output, 'Railway pinned apply output')
  if (result.status !== 'complete') {
    throw new Error(
      `Railway pinned apply for ${serviceName} ended ${String(result.status)}`,
    )
  }
  const diagnostics = array(result.diagnostics, 'Railway pinned apply diagnostics')
  if (diagnostics.length !== 0) {
    throw new Error(`Railway pinned apply for ${serviceName} reported diagnostics`)
  }
  const changes = array(result.changes, 'Railway pinned apply changes')
  if (changes.length !== 1) {
    throw new Error(`Railway pinned apply for ${serviceName} must report one change`)
  }
  const change = record(changes[0], 'Railway pinned apply change')
  if (
    change.kind !== 'resource.update' ||
    change.path !== `resources.service.${serviceName}.source` ||
    change.status !== 'applied'
  ) {
    throw new Error(`Railway pinned apply did not confirm ${serviceName} source`)
  }
}
