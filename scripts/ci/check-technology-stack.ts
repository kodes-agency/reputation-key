import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadContainerImagePolicy,
  validateContainerImagePolicy,
  type ContainerImagePolicy,
} from './check-container-image-policy'

type PackageSection = 'dependencies' | 'devDependencies'

type StackPackage = Readonly<{
  package: string
  section: PackageSection
  version: string
  role: string
}>

type ContainerBase = Readonly<{
  reference: string
  runtimeVersion: string
  owner: string
  updateMonitor: string
}>

type ActionAuthority = Readonly<{
  repository: string
  ref: string
  displayVersion: string
}>

type StackException = Readonly<{
  id: string
  scope: string
  owner: string
  expiresOn: string
  reason: string
}>

export type TechnologyStackAuthority = Readonly<{
  version: 1
  reviewedAt: string
  nextReviewBy: string
  owners: Readonly<Record<string, string>>
  runtime: Readonly<{
    nodeVersion: string
    nodeTypeSurfaceVersion: string
    packageManager: 'pnpm'
    packageManagerVersion: string
    runtimePackageManifest: string
    containerPolicy: string
  }>
  packages: readonly StackPackage[]
  externalContainerBases: readonly ContainerBase[]
  githubActions: readonly ActionAuthority[]
  runtimeContracts: Readonly<{
    pino: Readonly<{
      developmentTransport: 'pino-pretty'
      developmentOnly: true
      redactionAuthority: string
      builtEsmProof: string
    }>
    bullmqRedis: Readonly<{
      minimumRedisVersion: string
      requiredCommand: 'GETDEL'
      maxmemoryPolicy: 'noeviction'
      producerCommandTimeoutMs: number
      producerMaxRetriesPerRequest: number
      workerMaxRetriesPerRequest: null
      cacheMaxRetriesPerRequest: number
      productionIsolationRequired: true
    }>
    postgres: Readonly<{
      acquisitionRetryAllowed: true
      statementRetryCount: 0
    }>
  }>
  exceptions: readonly StackException[]
}>

export type TextSurface = Readonly<{ path: string; content: string }>

export type RuntimeContractSources = Readonly<{
  logger: string
  sensitiveFieldPolicy: string
  telemetry: string
  sentryEventScrub: string
  metricsSchema: string
  queue: string
  worker: string
  cacheRedis: string
  jobRedisRuntime: string
  redisTopology: string
  jobSchedulers: string
  workerBoot: string
  webBoot: string
  databasePool: string
  databasePoolTest: string
}>

type PackageManifest = Readonly<{
  packageManager?: unknown
  engines?: unknown
  scripts?: unknown
  dependencies?: unknown
  devDependencies?: unknown
}>

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u
const DATE = /^\d{4}-\d{2}-\d{2}$/u
const ACTION_SHA = /^[0-9a-f]{40}$/u
const IMAGE_DIGEST = /@sha256:[0-9a-f]{64}$/u

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function requireString(value: unknown, label: string, violations: string[]): string {
  if (typeof value === 'string' && value.trim() !== '') return value
  violations.push(`${label} must be a non-empty string`)
  return ''
}

function rows(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function collectReviewWindowViolations(
  root: Record<string, unknown>,
  violations: string[],
): void {
  if (root.version !== 1) violations.push('technology-stack authority version must be 1')
  for (const field of ['reviewedAt', 'nextReviewBy'] as const) {
    const date = requireString(root[field], field, violations)
    if (date && !DATE.test(date)) violations.push(`${field} must use YYYY-MM-DD`)
  }
  if (typeof root.nextReviewBy !== 'string') return
  const expiry = Date.parse(`${root.nextReviewBy}T23:59:59Z`)
  if (!Number.isNaN(expiry) && expiry < Date.now()) {
    violations.push(`technology-stack authority review expired on ${root.nextReviewBy}`)
  }
}

function collectOwnerViolations(
  owners: Record<string, unknown> | undefined,
  violations: string[],
): void {
  if (!owners || Object.keys(owners).length === 0) {
    violations.push('technology-stack authority requires named owners')
  }
  for (const [name, owner] of Object.entries(owners ?? {})) {
    requireString(owner, `owners.${name}`, violations)
  }
}

const RUNTIME_FIELDS = [
  'nodeVersion',
  'nodeTypeSurfaceVersion',
  'packageManager',
  'packageManagerVersion',
  'runtimePackageManifest',
  'containerPolicy',
] as const

function collectRuntimeViolations(value: unknown, violations: string[]): void {
  const runtime = record(value)
  if (!runtime) violations.push('technology-stack authority requires runtime')
  for (const field of RUNTIME_FIELDS) {
    requireString(runtime?.[field], `runtime.${field}`, violations)
  }
}

function collectPackageRowViolations(
  row: Record<string, unknown>,
  index: number,
  seen: Set<string>,
  violations: string[],
): void {
  const name = requireString(row.package, `packages[${index}].package`, violations)
  const version = requireString(row.version, `packages[${index}].version`, violations)
  requireString(row.role, `packages[${index}].role`, violations)
  if (row.section !== 'dependencies' && row.section !== 'devDependencies') {
    violations.push(`packages[${index}].section is invalid`)
  }
  if (version && !EXACT_VERSION.test(version)) {
    violations.push(`packages[${index}].version must be exact`)
  }
  if (name && seen.has(name)) violations.push(`duplicate package authority ${name}`)
  seen.add(name)
}

function collectPackageViolations(value: unknown, violations: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    violations.push('technology-stack authority requires package rows')
  }
  const seen = new Set<string>()
  for (const [index, candidate] of rows(value).entries()) {
    const row = record(candidate)
    if (!row) {
      violations.push(`packages[${index}] must be an object`)
      continue
    }
    collectPackageRowViolations(row, index, seen, violations)
  }
}

function collectContainerBaseRowViolations(
  row: Record<string, unknown>,
  index: number,
  violations: string[],
): void {
  const label = `externalContainerBases[${index}]`
  const reference = requireString(row.reference, `${label}.reference`, violations)
  if (reference && !IMAGE_DIGEST.test(reference)) {
    violations.push(`${label}.reference must be digest-pinned`)
  }
  requireString(row.runtimeVersion, `${label}.runtimeVersion`, violations)
  requireString(row.owner, `${label}.owner`, violations)
  requireString(row.updateMonitor, `${label}.updateMonitor`, violations)
}

function collectContainerBaseViolations(value: unknown, violations: string[]): void {
  if (!Array.isArray(value)) {
    violations.push('technology-stack authority requires externalContainerBases')
  }
  for (const [index, candidate] of rows(value).entries()) {
    const row = record(candidate)
    if (!row) {
      violations.push(`externalContainerBases[${index}] must be an object`)
      continue
    }
    collectContainerBaseRowViolations(row, index, violations)
  }
}

function collectActionRowViolations(
  row: Record<string, unknown>,
  index: number,
  seen: Set<string>,
  violations: string[],
): void {
  const label = `githubActions[${index}]`
  const repository = requireString(row.repository, `${label}.repository`, violations)
  const ref = requireString(row.ref, `${label}.ref`, violations)
  const display = requireString(row.displayVersion, `${label}.displayVersion`, violations)
  if (ref && !ACTION_SHA.test(ref))
    violations.push(`${repository} ref must be a full SHA`)
  if (display && !/^v\d+\S*$/u.test(display)) {
    violations.push(`${repository} displayVersion must start with v and a digit`)
  }
  if (repository && seen.has(repository)) {
    violations.push(`duplicate action authority ${repository}`)
  }
  seen.add(repository)
}

function collectActionAuthorityViolations(value: unknown, violations: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    violations.push('technology-stack authority requires githubActions')
  }
  const seen = new Set<string>()
  for (const [index, candidate] of rows(value).entries()) {
    const row = record(candidate)
    if (!row) {
      violations.push(`githubActions[${index}] must be an object`)
      continue
    }
    collectActionRowViolations(row, index, seen, violations)
  }
}

function collectExceptionRowViolations(
  row: Record<string, unknown>,
  index: number,
  seen: Set<string>,
  ownerNames: ReadonlySet<string>,
  violations: string[],
): void {
  const label = `exceptions[${index}]`
  const id = requireString(row.id, `${label}.id`, violations)
  requireString(row.scope, `${label}.scope`, violations)
  const owner = requireString(row.owner, `${label}.owner`, violations)
  const expiresOn = requireString(row.expiresOn, `${label}.expiresOn`, violations)
  requireString(row.reason, `${label}.reason`, violations)
  if (id && seen.has(id)) violations.push(`duplicate stack exception ${id}`)
  seen.add(id)
  if (owner && !ownerNames.has(owner)) {
    violations.push(`stack exception ${id} has unknown owner ${owner}`)
  }
  if (expiresOn && !DATE.test(expiresOn)) {
    violations.push(`stack exception ${id} expiry must use YYYY-MM-DD`)
  } else if (expiresOn && Date.parse(`${expiresOn}T23:59:59Z`) < Date.now()) {
    violations.push(`stack exception ${id} expired on ${expiresOn}`)
  }
}

function collectExceptionViolations(
  value: unknown,
  owners: Record<string, unknown> | undefined,
  violations: string[],
): void {
  const ownerNames = new Set(
    Object.values(owners ?? {}).filter(
      (owner): owner is string => typeof owner === 'string',
    ),
  )
  const seen = new Set<string>()
  for (const [index, candidate] of rows(value).entries()) {
    const row = record(candidate)
    if (!row) {
      violations.push(`exceptions[${index}] must be an object`)
      continue
    }
    collectExceptionRowViolations(row, index, seen, ownerNames, violations)
  }
}

export function validateAuthorityShape(value: unknown): readonly string[] {
  const root = record(value)
  if (!root) return ['technology-stack authority must be an object']

  const violations: string[] = []
  const owners = record(root.owners)
  collectReviewWindowViolations(root, violations)
  collectOwnerViolations(owners, violations)
  collectRuntimeViolations(root.runtime, violations)
  collectPackageViolations(root.packages, violations)
  collectContainerBaseViolations(root.externalContainerBases, violations)
  collectActionAuthorityViolations(root.githubActions, violations)
  collectExceptionViolations(root.exceptions, owners, violations)
  return violations
}

export function loadTechnologyStackAuthority(root: string): TechnologyStackAuthority {
  const value = JSON.parse(
    readFileSync(join(root, 'security/technology-stack.json'), 'utf8'),
  ) as unknown
  const violations = validateAuthorityShape(value)
  if (violations.length > 0) throw new Error(violations.join('\n'))
  return value as TechnologyStackAuthority
}

function lockImporterVersions(lockfile: string): ReadonlyMap<string, string> {
  const versions = new Map<string, string>()
  const lines = lockfile.split('\n')
  const importerStart = lines.findIndex((line) => line === '  .:')
  if (importerStart < 0) return versions
  let section: PackageSection | undefined
  let currentPackage: string | undefined
  for (let index = importerStart + 1; index < lines.length; index += 1) {
    const line = lines[index]!
    if (/^\S/u.test(line)) break
    const sectionMatch = /^ {4}(dependencies|devDependencies):\s*$/u.exec(line)
    if (sectionMatch) {
      section = sectionMatch[1] as PackageSection
      currentPackage = undefined
      continue
    }
    const packageMatch = /^ {6}(?:'([^']+)'|([^:\s]+)):\s*$/u.exec(line)
    if (packageMatch && section) {
      currentPackage = packageMatch[1] ?? packageMatch[2]
      continue
    }
    const versionMatch = /^ {8}version:\s*([^\s(]+).*$/u.exec(line)
    if (versionMatch && section && currentPackage) {
      versions.set(`${section}:${currentPackage}`, versionMatch[1]!)
    }
  }
  return versions
}

export function validatePackageVersions(
  authority: TechnologyStackAuthority,
  packageManifest: PackageManifest,
  lockfile: string,
): readonly string[] {
  const violations: string[] = []
  const locked = lockImporterVersions(lockfile)
  for (const row of authority.packages) {
    const section = record(packageManifest[row.section])
    const declared = section?.[row.package]
    if (declared !== row.version) {
      violations.push(
        `${row.package} must be declared exactly as ${row.version}; found ${String(declared)}`,
      )
    }
    const resolved = locked.get(`${row.section}:${row.package}`)
    if (resolved !== row.version) {
      violations.push(
        `${row.package} must resolve to ${row.version} in pnpm-lock.yaml; found ${String(resolved)}`,
      )
    }
  }
  return violations
}

export function validateMutableCommandSurfaces(
  surfaces: readonly TextSurface[],
): readonly string[] {
  const violations: string[] = []
  for (const surface of surfaces) {
    const content = surface.content
    if (/\bnpx\s+(?:--yes|-y)\b/u.test(content)) {
      violations.push(`${surface.path}: mutable CLI invocation uses npx -y`)
    }
    if (/\bpnpm\s+dlx\b/u.test(content)) {
      violations.push(`${surface.path}: mutable CLI invocation uses pnpm dlx`)
    }
    if (/(?:^|[\s"'])@latest\b|[A-Za-z0-9_.@/-]+@latest\b/mu.test(content)) {
      violations.push(`${surface.path}: mutable package selector uses @latest`)
    }
  }
  return violations
}

function actionRepository(actionPath: string): string {
  return actionPath.split('/').slice(0, 2).join('/')
}

/**
 * Grades a single `uses:` invocation, recording the repository in `used` when it
 * resolves to a known authority row. Returns the violation, if any.
 */
function actionInvocationViolation(
  workflowPath: string,
  invocation: string,
  displayVersion: string,
  expected: ReadonlyMap<string, ActionAuthority>,
  used: Set<string>,
): string | undefined {
  if (invocation.startsWith('./')) return undefined
  if (invocation.startsWith('docker://')) {
    return IMAGE_DIGEST.test(invocation)
      ? undefined
      : `${workflowPath}: docker action ${invocation} is not digest-pinned`
  }
  const separator = invocation.lastIndexOf('@')
  const ref = separator >= 0 ? invocation.slice(separator + 1) : ''
  if (!ACTION_SHA.test(ref)) {
    return `${workflowPath}: action ${invocation} is not pinned to a full commit SHA`
  }
  const repository = actionRepository(invocation.slice(0, separator))
  const allowed = expected.get(repository)
  if (!allowed) return `${workflowPath}: action ${repository} is absent from authority`
  used.add(repository)
  if (allowed.ref === ref && allowed.displayVersion === displayVersion) return undefined
  return `${workflowPath}: action ${repository} must use ${allowed.ref} # ${allowed.displayVersion}`
}

export function validateActionAuthority(
  authority: TechnologyStackAuthority,
  workflows: readonly TextSurface[],
): readonly string[] {
  const violations: string[] = []
  const expected = new Map(
    authority.githubActions.map((row) => [row.repository, row] as const),
  )
  const used = new Set<string>()
  for (const workflow of workflows) {
    for (const match of workflow.content.matchAll(
      /^\s*-?\s*uses:\s*([^\s#]+)(?:\s*#\s*(\S+))?\s*$/gmu,
    )) {
      const violation = actionInvocationViolation(
        workflow.path,
        match[1]!,
        match[2] ?? '',
        expected,
        used,
      )
      if (violation !== undefined) violations.push(violation)
    }
  }
  for (const repository of expected.keys()) {
    if (!used.has(repository)) violations.push(`action authority ${repository} is stale`)
  }
  return violations
}

type DockerBaseScan = Readonly<{
  authority: TechnologyStackAuthority
  allowed: ReadonlySet<string>
  used: Set<string>
  violations: string[]
}>

function collectNodeBaseViolations(
  dockerfile: string,
  content: string,
  scan: DockerBaseScan,
): void {
  const { nodeVersion, packageManagerVersion } = scan.authority.runtime
  if (!content.includes(`node:'${nodeVersion}'`)) {
    scan.violations.push(
      `${dockerfile}: Node base does not assert runtime ${nodeVersion}`,
    )
  }
  const pinnedPnpm = `pnpm@${packageManagerVersion}`
  const packageManagedPnpm =
    content.includes('COPY package.json') &&
    content.includes('pnpm install --frozen-lockfile')
  if (!content.includes(pinnedPnpm) && !packageManagedPnpm) {
    scan.violations.push(
      `${dockerfile}: pnpm must come from ${pinnedPnpm} or the copied packageManager authority`,
    )
  }
}

function collectBaseImageViolations(
  dockerfile: string,
  image: string,
  content: string,
  scan: DockerBaseScan,
): void {
  if (!IMAGE_DIGEST.test(image)) {
    scan.violations.push(`${dockerfile}: external base ${image} is not digest-pinned`)
  } else if (!scan.allowed.has(image)) {
    scan.violations.push(
      `${dockerfile}: external base ${image} is absent from the technology-stack authority`,
    )
  } else {
    scan.used.add(image)
  }
  if (image.startsWith('node:')) collectNodeBaseViolations(dockerfile, content, scan)
}

/** Grades every distinct `FROM` base, skipping references to earlier stages. */
function collectDockerfileBaseViolations(
  dockerfile: string,
  content: string,
  scan: DockerBaseScan,
): void {
  const stages = new Set<string>()
  for (const match of content.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/gimu)) {
    const image = match[1]!
    if (!stages.has(image)) {
      collectBaseImageViolations(dockerfile, image, content, scan)
    }
    if (match[2]) stages.add(match[2])
  }
}

export function validateDockerBaseAuthority(
  authority: TechnologyStackAuthority,
  policy: ContainerImagePolicy,
  dockerfiles: readonly TextSurface[],
): readonly string[] {
  const contentByPath = new Map(dockerfiles.map((file) => [file.path, file.content]))
  const allowed = new Set(
    authority.externalContainerBases.map(({ reference }) => reference),
  )
  const scan: DockerBaseScan = {
    authority,
    allowed,
    used: new Set<string>(),
    violations: [],
  }
  for (const { dockerfile } of policy.images) {
    const content = contentByPath.get(dockerfile)
    if (content === undefined) {
      scan.violations.push(
        `${dockerfile}: Dockerfile content is missing from stack validation`,
      )
      continue
    }
    collectDockerfileBaseViolations(dockerfile, content, scan)
  }
  for (const reference of allowed) {
    if (!scan.used.has(reference))
      scan.violations.push(`external base authority ${reference} is stale`)
  }
  return scan.violations
}

export function validateDatabaseGuidance(
  executableSurfaces: readonly TextSurface[],
  guidanceSurfaces: readonly TextSurface[],
): readonly string[] {
  const violations: string[] = []
  for (const surface of executableSurfaces) {
    const executableContent = surface.content
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')
    if (/\b(?:pnpm\s+)?db:push\b|\bdrizzle-kit\s+push\b/u.test(executableContent)) {
      violations.push(`${surface.path}: executable schema push is forbidden`)
    }
  }
  const explicitDenial =
    /\b(?:never|do\s+not|don't|must\s+not|forbidden|prohibited|no)\b.*\b(?:pnpm\s+)?db:push\b|\b(?:pnpm\s+)?db:push\b.*\b(?:forbidden|prohibited|bypasses)\b/iu
  for (const surface of guidanceSurfaces) {
    for (const [index, line] of surface.content.split('\n').entries()) {
      if (!/\b(?:pnpm\s+)?db:push\b|\bdrizzle-kit\s+push\b/u.test(line)) continue
      if (!explicitDenial.test(line)) {
        violations.push(
          `${surface.path}:${index + 1}: schema-push guidance is not an explicit prohibition`,
        )
      }
    }
  }
  return violations
}

function requireSnippet(
  source: string,
  snippet: string,
  violation: string,
  violations: string[],
): void {
  if (!source.includes(snippet)) violations.push(violation)
}

export function validateRuntimeContractSources(
  authority: TechnologyStackAuthority,
  sources: RuntimeContractSources,
): readonly string[] {
  const violations: string[] = []
  const pino = authority.runtimeContracts.pino
  requireSnippet(
    sources.logger,
    'createRequire(import.meta.url).resolve',
    'pino development transport must resolve from the built ESM module',
    violations,
  )
  requireSnippet(
    sources.logger,
    `target: '${pino.developmentTransport}'`,
    `pino development transport must target ${pino.developmentTransport}`,
    violations,
  )
  requireSnippet(
    sources.logger,
    "env.NODE_ENV === 'development'",
    'pino-pretty must be development-only',
    violations,
  )
  for (const [label, source] of [
    ['logger', sources.logger],
    ['metrics', sources.metricsSchema],
  ] as const) {
    requireSnippet(
      source,
      'isSensitiveObservabilityField',
      `${label} must consume the shared sensitive-field authority`,
      violations,
    )
  }
  if (
    !sources.telemetry.includes("from './sentry-event-scrub'") ||
    !sources.sentryEventScrub.includes("from './sensitive-field-policy'") ||
    !sources.sentryEventScrub.includes('isSensitiveObservabilityField')
  ) {
    violations.push(
      'telemetry must consume the shared sensitive-field authority through sentry-event-scrub',
    )
  }
  requireSnippet(
    sources.sensitiveFieldPolicy,
    'SENSITIVE_OBSERVABILITY_FIELD_NAMES',
    'observability redaction authority must expose the normalized field vocabulary',
    violations,
  )

  const redis = authority.runtimeContracts.bullmqRedis
  requireSnippet(
    sources.jobRedisRuntime,
    `JOB_REDIS_MINIMUM_VERSION = '${redis.minimumRedisVersion}'`,
    `BullMQ Redis minimum must remain ${redis.minimumRedisVersion}`,
    violations,
  )
  requireSnippet(
    sources.jobRedisRuntime,
    `'${redis.requiredCommand}'`,
    `BullMQ Redis must assert ${redis.requiredCommand} availability`,
    violations,
  )
  requireSnippet(
    sources.jobRedisRuntime,
    `policy !== '${redis.maxmemoryPolicy}'`,
    `BullMQ Redis must require ${redis.maxmemoryPolicy}`,
    violations,
  )
  requireSnippet(
    sources.queue,
    `JOB_QUEUE_COMMAND_TIMEOUT_MS = ${redis.producerCommandTimeoutMs.toLocaleString('en-US').replace(',', '_')}`,
    `BullMQ producers must keep the ${redis.producerCommandTimeoutMs}ms command bound`,
    violations,
  )
  requireSnippet(
    sources.queue,
    `maxRetriesPerRequest: ${redis.producerMaxRetriesPerRequest}`,
    'BullMQ producers must use a bounded retry budget',
    violations,
  )
  requireSnippet(
    sources.queue,
    "queue.on('error'",
    'BullMQ Queue instances must own a structured error handler',
    violations,
  )
  requireSnippet(
    sources.worker,
    'maxRetriesPerRequest: null',
    'BullMQ Worker connections must retry blocking commands indefinitely',
    violations,
  )
  requireSnippet(
    sources.worker,
    "worker.on('error'",
    'BullMQ Worker instances must own a structured error handler',
    violations,
  )
  requireSnippet(
    sources.cacheRedis,
    `maxRetriesPerRequest: ${redis.cacheMaxRetriesPerRequest}`,
    'cache Redis must retain its bounded non-worker retry policy',
    violations,
  )
  requireSnippet(
    sources.cacheRedis,
    "redis.on('error'",
    'cache Redis must own an error handler',
    violations,
  )
  requireSnippet(
    sources.redisTopology,
    "env.NODE_ENV !== 'production'",
    'single-Redis fallback must remain non-production only',
    violations,
  )
  requireSnippet(
    sources.redisTopology,
    'endpoints_not_isolated',
    'production cache and queue Redis endpoints must remain isolated',
    violations,
  )
  requireSnippet(
    sources.jobSchedulers,
    'upsertJobScheduler',
    'recurring work must use the BullMQ Job Scheduler API',
    violations,
  )
  // ARC-03-T15 named the per-deployable construction seam, so the worker now
  // calls createWorkerContainer() instead of createContainer({enableJobs:true}).
  // The guarantee is unchanged: Redis compatibility is proven before anything
  // opens a queue connection.
  const workerAssertion = sources.workerBoot.indexOf(
    'await assertConfiguredJobRedisRuntime',
  )
  const workerConstruction = sources.workerBoot.indexOf('createWorkerContainer(')
  if (
    workerAssertion < 0 ||
    workerConstruction < 0 ||
    workerAssertion >= workerConstruction
  ) {
    violations.push('worker must assert Redis compatibility before queue construction')
  }
  // The worker must go through the deployable seam, or it could build a second
  // complete container in the same process and reopen the duplicate-registry
  // failure the seam exists to prevent.
  if (/\bcreateContainer\s*\(/u.test(sources.workerBoot)) {
    violations.push(
      'worker must construct through createWorkerContainer, not createContainer',
    )
  }
  requireSnippet(
    sources.webBoot,
    'await assertConfiguredJobRedisRuntime(redisUrl)',
    'web producers must assert Redis compatibility at boot',
    violations,
  )

  const postgres = authority.runtimeContracts.postgres
  if (!postgres.acquisitionRetryAllowed || postgres.statementRetryCount !== 0) {
    violations.push('PostgreSQL authority must allow acquisition retry and forbid replay')
  }
  requireSnippet(
    sources.databasePool,
    'wrapPoolConnectWithRetry(pool)',
    'PostgreSQL resilience must wrap acquisition only',
    violations,
  )
  if (/pool\.query\s*=|retryTransient\([^)]*\.query/su.test(sources.databasePool)) {
    violations.push('PostgreSQL statement execution must not be wrapped in retries')
  }
  requireSnippet(
    sources.databasePoolTest,
    'never retries pool.query after an ambiguous connection failure',
    'PostgreSQL non-replay rule requires an executable regression proof',
    violations,
  )
  return violations
}

function filesUnder(directory: string, accept: (path: string) => boolean): string[] {
  const files: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && accept(path)) files.push(path)
    }
  }
  walk(directory)
  return files.sort()
}

function surfaces(root: string, paths: readonly string[]): readonly TextSurface[] {
  return paths.map((path) => ({
    path: relative(root, path).split('\\').join('/'),
    content: readFileSync(path, 'utf8'),
  }))
}

function workflowSurfaces(root: string): readonly TextSurface[] {
  return surfaces(
    root,
    filesUnder(join(root, '.github/workflows'), (path) => /\.ya?ml$/u.test(path)),
  )
}

function packageScriptSurfaces(packageManifest: PackageManifest): readonly TextSurface[] {
  const scripts = record(packageManifest.scripts) ?? {}
  return Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, content]) => ({ path: `package.json#scripts.${name}`, content }))
}

function commandSurfaces(
  root: string,
  packageManifest: PackageManifest,
): readonly TextSurface[] {
  const paths = [
    join(root, '.mcp.json'),
    join(root, '.codex/config.toml'),
    ...readdirSync(root)
      .filter((name) => name === 'Dockerfile' || name.startsWith('Dockerfile.'))
      .map((name) => join(root, name)),
    ...filesUnder(join(root, '.github/workflows'), (path) => /\.ya?ml$/u.test(path)),
    ...filesUnder(join(root, '.railway'), (path) => /\.(?:json|toml|ya?ml)$/u.test(path)),
    ...filesUnder(join(root, 'scripts'), (path) => /\.(?:sh|bash)$/u.test(path)),
    ...filesUnder(join(root, 'services'), (path) => /railway\.json$/u.test(path)),
  ]
  return [...packageScriptSurfaces(packageManifest), ...surfaces(root, paths)]
}

function guidanceSurfaces(root: string): readonly TextSurface[] {
  return surfaces(root, [
    join(root, 'README.md'),
    join(root, 'MIGRATION.md'),
    join(root, 'CONTEXT.md'),
    join(root, 'src/shared/db/CONTEXT.md'),
    ...filesUnder(join(root, 'docs/operations'), (path) => path.endsWith('.md')),
  ])
}

export function loadRuntimeContractSources(root: string): RuntimeContractSources {
  const read = (path: string): string => readFileSync(join(root, path), 'utf8')
  return {
    logger: read('src/shared/observability/logger.ts'),
    sensitiveFieldPolicy: read('src/shared/observability/sensitive-field-policy.ts'),
    telemetry: read('src/shared/observability/telemetry.ts'),
    sentryEventScrub: read('src/shared/observability/sentry-event-scrub.ts'),
    metricsSchema: read('src/shared/observability/metrics-schema.ts'),
    queue: read('src/shared/jobs/queue.ts'),
    worker: read('src/shared/jobs/worker.ts'),
    cacheRedis: read('src/shared/cache/redis.ts'),
    jobRedisRuntime: read('src/shared/jobs/redis-runtime.ts'),
    redisTopology: read('src/shared/jobs/redis-topology.ts'),
    jobSchedulers: read('src/shared/jobs/job-schedulers.ts'),
    workerBoot: read('src/worker/index.ts'),
    webBoot: read('server/plugins/redis-runtime-guard.ts'),
    databasePool: read('src/shared/db/pool.ts'),
    databasePoolTest: read('src/shared/db/pool.test.ts'),
  }
}

function validateRuntimeAuthorityFiles(
  root: string,
  authority: TechnologyStackAuthority,
  packageManifest: PackageManifest,
  workflows: readonly TextSurface[],
): readonly string[] {
  const violations: string[] = []
  const engines = record(packageManifest.engines)
  const expectedManager = `${authority.runtime.packageManager}@${authority.runtime.packageManagerVersion}`
  if (packageManifest.packageManager !== expectedManager) {
    violations.push(`packageManager must be ${expectedManager}`)
  }
  if (engines?.node !== authority.runtime.nodeVersion) {
    violations.push(`package.json engines.node must be ${authority.runtime.nodeVersion}`)
  }
  if (
    readFileSync(join(root, '.nvmrc'), 'utf8').trim() !== authority.runtime.nodeVersion
  ) {
    violations.push(`.nvmrc must be ${authority.runtime.nodeVersion}`)
  }
  const runtimeManifest = JSON.parse(
    readFileSync(join(root, authority.runtime.runtimePackageManifest), 'utf8'),
  ) as PackageManifest
  if (record(runtimeManifest.engines)?.node !== authority.runtime.nodeVersion) {
    violations.push(
      `${authority.runtime.runtimePackageManifest} engines.node must be ${authority.runtime.nodeVersion}`,
    )
  }
  if (authority.runtime.containerPolicy !== 'security/container-images.json') {
    violations.push(
      'runtime.containerPolicy must point to security/container-images.json',
    )
  }
  if (
    authority.runtimeContracts.pino.redactionAuthority !==
    'src/shared/observability/sensitive-field-policy.ts'
  ) {
    violations.push(
      'pino.redactionAuthority must point to the shared sensitive-field policy',
    )
  }
  if (
    authority.runtimeContracts.pino.builtEsmProof !== 'scripts/ci/pino-esm-build.test.ts'
  ) {
    violations.push('pino.builtEsmProof must point to the executable ESM proof')
  }
  const nodeTypes = authority.packages.find(({ package: name }) => name === '@types/node')
  if (nodeTypes?.version !== authority.runtime.nodeTypeSurfaceVersion) {
    violations.push(
      'runtime nodeTypeSurfaceVersion must match the @types/node authority row',
    )
  }
  if (
    authority.runtime.nodeVersion.split('.')[0] !==
    authority.runtime.nodeTypeSurfaceVersion.split('.')[0]
  ) {
    violations.push('Node runtime and @types/node must have the same supported major')
  }
  for (const workflow of workflows) {
    const lines = workflow.content.split('\n')
    for (const [index, line] of lines.entries()) {
      if (!/^\s*-\s+uses:\s+actions\/setup-node@/u.test(line)) continue
      const step = lines.slice(index, index + 8).join('\n')
      if (!step.includes('node-version-file: .nvmrc')) {
        violations.push(`${workflow.path}: setup-node must consume .nvmrc`)
      }
    }
  }
  return violations
}

export function validateTechnologyStack(root: string): readonly string[] {
  try {
    const authorityRaw = JSON.parse(
      readFileSync(join(root, 'security/technology-stack.json'), 'utf8'),
    ) as unknown
    const violations = [...validateAuthorityShape(authorityRaw)]
    if (violations.length > 0) return violations
    const authority = authorityRaw as TechnologyStackAuthority
    const packageManifest = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as PackageManifest
    const workflows = workflowSurfaces(root)
    const commands = commandSurfaces(root, packageManifest)
    const policy = loadContainerImagePolicy(root)
    const dockerfiles = surfaces(
      root,
      policy.images.map(({ dockerfile }) => join(root, dockerfile)),
    )
    return [
      ...validateRuntimeAuthorityFiles(root, authority, packageManifest, workflows),
      ...validatePackageVersions(
        authority,
        packageManifest,
        readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'),
      ),
      ...validateMutableCommandSurfaces(commands),
      ...validateActionAuthority(authority, workflows),
      ...validateContainerImagePolicy(root),
      ...validateDockerBaseAuthority(authority, policy, dockerfiles),
      ...validateDatabaseGuidance(commands, guidanceSurfaces(root)),
      ...validateRuntimeContractSources(authority, loadRuntimeContractSources(root)),
    ]
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
}

export function runTechnologyStackCli(args: readonly string[]): number {
  const root = resolve(args[0] ?? join(dirname(fileURLToPath(import.meta.url)), '../..'))
  const violations = validateTechnologyStack(root)
  if (violations.length > 0) {
    process.stderr.write(
      `[technology-stack] FAILED — ${violations.length} violation(s):\n${violations
        .map((violation) => `  - ${violation}`)
        .join('\n')}\n`,
    )
    return 1
  }
  const authority = loadTechnologyStackAuthority(root)
  const containers = loadContainerImagePolicy(root)
  process.stdout.write(
    `[technology-stack] OK — Node ${authority.runtime.nodeVersion}, ${authority.packages.length} exact package authorities, ${authority.githubActions.length} action authorities, ${containers.images.length} governed images, ${authority.exceptions.length} owned exception\n`,
  )
  return 0
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runTechnologyStackCli(process.argv.slice(2))
}
