// BQC-2.1 — entry-point catalogue guard test.
//
// Fails when an executable entry point exists without a catalogue row, when a
// row drifts from the code (wrong action/capability/gate), or when a row goes
// stale (file/export removed). This is the CI gate required by phase BQC-2
// §2.1: "CI fails when a new executable entry point lacks a catalogue row and
// policy test."
//
// Discovery is mechanical:
//   1. server functions — `export const x = createServerFn({ method })` and
//      `createServerOnlyFn(...)` scans, with per-function extraction of
//      requireAuthorized/assert*Capability calls
//   2. UI + API routes — file walk of src/routes (TanStack Router conventions)
//   3. jobs — actual production-reachable registry/gated registrations,
//      including context-owned worker registrars, imported constants,
//      dynamic-import aliases, and composed metric loops
//   4. consumers — registration tables plus the production composition call
//      site (or an explicit declared-only classification)
//   5. schedules — the single operational job authority consumed by the worker
//   6. operator commands — scripts/ file walk + package.json script coverage
//
// The policy test: every row's beta posture is re-derived from the
// authoritative capability sets, and every row's capability decision is
// executed against the default (empty-env) policy store — blocked and
// non-core rows must deny, core rows must allow.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import {
  ENTRY_POINT_CATALOGUE,
  postureForCapability,
  validateEntryPointGovernance,
  type EntryPointRow,
} from './entry-point-catalogue'
import { capabilityForPermission } from '#/shared/auth/capability-for-permission'
import {
  checkBetaCapability,
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  isBlockedCapability,
  resetCapabilityPolicyStore,
  type Capability,
} from '#/shared/auth/beta-capabilities'
import { userId, organizationId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { JOB_OPERATIONAL_CONTRACTS } from '#/shared/jobs/operational-catalogue'
import { walk } from '#/shared/testing/source-tree'

const ROOT = process.cwd()
const rel = (abs: string): string => relative(ROOT, abs)

const read = (abs: string): string => readFileSync(abs, 'utf8')

// ── 1. Server functions ─────────────────────────────────────────────

type DiscoveredFn = Readonly<{
  name: string
  file: string
  method: string
  /** requireAuthorized action literals in this function's slice. */
  actions: ReadonlyArray<string>
  /** assertBetaCapability / assertGlobalCapability literals. */
  caps: ReadonlyArray<string>
}>

const isTsNonTest = (f: string): boolean => f.endsWith('.ts') && !f.endsWith('.test.ts')

function contextServerFiles(): string[] {
  const contextsDir = join(ROOT, 'src/contexts')
  return readdirSync(contextsDir, { withFileTypes: true })
    .filter((ctx) => ctx.isDirectory())
    .map((ctx) => join(contextsDir, ctx.name, 'server'))
    .filter((serverDir) => existsSync(serverDir))
    .flatMap((serverDir) => walk(serverDir).filter(isTsNonTest))
}

function routeHelperFiles(): string[] {
  return walk(join(ROOT, 'src/routes'))
    .filter(isTsNonTest)
    .filter((f) => (f.split('/').pop() ?? '').startsWith('-'))
}

function serverFnFiles(): string[] {
  return [
    ...contextServerFiles(),
    join(ROOT, 'src/shared/auth/auth.functions.ts'),
    ...routeHelperFiles(),
  ].sort()
}

const FN_RE =
  /export const (\w+) = (?:createServerFn\(\{\s*method:\s*'(GET|POST)'\s*,?\s*\}\)|createServerOnlyFn\s*\()/g
const REQUIRE_AUTHZ_RE = /(?:requireAuthorized|requireExecutionAllowed)\(\s*\{([^}]*)\}/g
const ACTION_RE = /action:\s*'([^']+)'/
const SCOPED_AUTHZ_RE = /authorize[A-Za-z]+\(\s*[\s\S]{0,200}?'([^']+)'/g
const CAPABILITY_ARG_RE = /capability:\s*'([^']+)'/
const SCOPED_CAPABILITY_RE =
  /authorize[A-Za-z]+\([\s\S]{0,250}?,\s*'((?:team|goal|badge|leaderboard)\.use|portal\.(?:read|write|upload|public_read|guest_response|guest_text|guest_contact|guest_media))'\s*,?\s*\)/g
const ASSERT_CTX_CAP_RE = /assertBetaCapability\(\s*[^,]+,\s*'([^']+)'/g
const ASSERT_GLOBAL_CAP_RE = /assertGlobalCapability\(\s*'([^']+)'\s*\)/g

function discoverServerFunctionDeclarations(
  content: string,
  file: string,
): ReadonlyArray<DiscoveredFn> {
  const out: DiscoveredFn[] = []
  const matches = [...content.matchAll(FN_RE)]
  matches.forEach((m, i) => {
    const slice = content.slice(m.index, matches[i + 1]?.index ?? content.length)
    const directActions = [...slice.matchAll(REQUIRE_AUTHZ_RE)]
      .map((r) => ACTION_RE.exec(r[1])?.[1])
      .filter((a): a is string => Boolean(a))
    const scopedActions = [...slice.matchAll(SCOPED_AUTHZ_RE)].map((r) => r[1])
    const actions = [...new Set([...directActions, ...scopedActions])]
    const explicitCaps = [...slice.matchAll(REQUIRE_AUTHZ_RE)]
      .map((r) => CAPABILITY_ARG_RE.exec(r[1])?.[1])
      .filter((a): a is string => Boolean(a))
    const scopedCaps = [...slice.matchAll(SCOPED_CAPABILITY_RE)].map((r) => r[1])
    const caps = [
      ...[...slice.matchAll(ASSERT_CTX_CAP_RE)].map((r) => r[1]),
      ...[...slice.matchAll(ASSERT_GLOBAL_CAP_RE)].map((r) => r[1]),
      ...explicitCaps,
      ...scopedCaps,
    ]
    out.push({
      name: m[1],
      file,
      method: m[2] ?? 'SERVER_ONLY',
      actions,
      caps,
    })
  })
  return out
}

function discoverServerFunctions(): ReadonlyArray<DiscoveredFn> {
  const out: DiscoveredFn[] = []
  for (const abs of serverFnFiles()) {
    const content = read(abs)
    out.push(...discoverServerFunctionDeclarations(content, rel(abs)))
  }
  return out
}

// ── 2. Routes ───────────────────────────────────────────────────────

type DiscoveredRoute = Readonly<{
  name: string
  file: string
  kind: 'route_ui' | 'route_api'
}>

function routeName(file: string): string {
  const r = rel(file)
    .replace(/^src\/routes\//, '')
    .replace(/\.(ts|tsx)$/, '')
  if (r === '__root') return '__root'
  if (r === '_authenticated') return '_authenticated'
  const segments = r.split('/').filter((s) => s !== '_authenticated')
  if (segments[segments.length - 1] === 'index') segments.pop()
  return '/' + segments.join('/')
}

function discoverRoutes(): ReadonlyArray<DiscoveredRoute> {
  const routes = walk(join(ROOT, 'src/routes'))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
    // TanStack file-based routing opts out ANY path segment prefixed with '-'
    // (files like -notification-fns.ts AND directories like -queries/).
    .filter((f) => {
      const relSegments = rel(f)
        .replace(/^src\/routes\//, '')
        .split('/')
      return !relSegments.some((seg) => seg.startsWith('-'))
    })
    .map((f) => ({
      name: routeName(f),
      file: rel(f),
      kind: rel(f).startsWith('src/routes/api/')
        ? ('route_api' as const)
        : ('route_ui' as const),
    }))
  // Layout files (non-index) whose derived path collides with an index file
  // get a discriminator so catalogue ids stay unique
  // (e.g. settings.tsx layout vs settings/index.tsx).
  const nameCounts = new Map<string, number>()
  for (const r of routes) nameCounts.set(r.name, (nameCounts.get(r.name) ?? 0) + 1)
  return routes.map((r) =>
    nameCounts.get(r.name)! > 1 && !/\/index\.(ts|tsx)$/.test(r.file)
      ? { ...r, name: `${r.name} (layout)` }
      : r,
  )
}

// ── 3. Jobs ─────────────────────────────────────────────────────────

type JobRegistrationReference = Readonly<{
  literal: string | undefined
  identifier: string | undefined
  contextOwnedFacade: string | undefined
}>

function extractJobRegistrationReferences(
  source: string,
): readonly JobRegistrationReference[] {
  return [
    ...source.matchAll(
      /(?:jobRegistry|registry)\.register\(\s*(?:'([^']+)'|([A-Z][A-Z0-9_]+)|((?:\w+\.)*\w+)\.jobName)|registerCapabilityGatedJob\(\s*(?:'([^']+)'|([A-Z][A-Z0-9_]+)|((?:\w+\.)*\w+)\.jobName)/g,
    ),
  ].map((match) => ({
    literal: match[1] ?? match[4],
    identifier: match[2] ?? match[5],
    contextOwnedFacade: match[3] ?? match[6],
  }))
}

/** Resolve an imported job-name constant to its string value. */
function resolveJobConstant(constName: string, sourceFile: string): string | undefined {
  const content = read(join(ROOT, sourceFile))
  const single = new RegExp(`export const ${constName}\\s*=\\s*'([^']+)'`).exec(content)
  if (single) return single[1]
  const record = new RegExp(`export const ${constName}\\s*=\\s*\\{([\\s\\S]*?)\\}`).exec(
    content,
  )
  return record?.[1]
}

/** Import map for a file: local identifier → { constName, sourceFile }. */
function importMap(file: string): Map<string, { constName: string; sourceFile: string }> {
  const content = read(join(ROOT, file))
  const map = new Map<string, { constName: string; sourceFile: string }>()
  const add = (names: string, source: string) => {
    const sourceFile = `${
      source.startsWith('#/')
        ? source.replace(/^#\//, 'src/')
        : join(dirname(file), source)
    }${source.endsWith('.ts') ? '' : '.ts'}`
    for (const part of names.split(',')) {
      const m = /(\w+)\s+as\s+(\w+)/.exec(part.trim())
      const destructuredAlias = /(\w+)\s*:\s*(\w+)/.exec(part.trim())
      if (m) map.set(m[2], { constName: m[1], sourceFile })
      else if (destructuredAlias) {
        map.set(destructuredAlias[2], {
          constName: destructuredAlias[1],
          sourceFile,
        })
      } else if (/^\w+$/.test(part.trim()))
        map.set(part.trim(), { constName: part.trim(), sourceFile })
    }
  }
  for (const m of content.matchAll(/import \{([^}]+)\} from '([^']+)'/g)) add(m[1], m[2])
  // dynamic imports destructure into const { A, B } = await import(...)
  for (const m of content.matchAll(
    /const \{([^}]+)\}\s*=\s*await import\('([^']+)'\)/g,
  )) {
    add(m[1], m[2])
  }
  return map
}

/**
 * Resolve the one context-owned job-name facade currently composed into the
 * production container. Every link must remain visible in source: bootstrap's
 * local alias, composition's Goal worker binding, Goal's build function, and
 * the imported literal job-name constant. An arbitrary `.jobName` property is
 * deliberately not treated as a production registration authority.
 */
function resolveContextOwnedJobName(
  registrationSource: string,
  facade: string | undefined,
): string | undefined {
  if (!facade) return undefined
  const runtimePath = 'container.goalWorkerRuntime.programMaintenance'
  const resolvesToRuntimePath =
    facade === runtimePath ||
    new RegExp(`\\bconst\\s+${facade}\\s*=\\s*${runtimePath}\\b`, 'u').test(
      registrationSource,
    )
  if (!resolvesToRuntimePath) return undefined

  // ARC-03-T10 moved the leaf-context builds out of the root, so the chain is
  // followed through the root's delegation rather than assumed to sit inline.
  const compositionFile = 'src/composition.ts'
  const leafContextsFile = 'src/composition/read-and-notify-contexts.ts'
  const goalBuildFile = 'src/contexts/goal/build.ts'
  const composition = read(join(ROOT, compositionFile))
  const leafContexts = read(join(ROOT, leafContextsFile))
  const goalBuildTarget = importMap(leafContextsFile).get('buildGoalContext')
  if (
    goalBuildTarget?.sourceFile !== goalBuildFile ||
    importMap(compositionFile).get('buildReadAndNotifyContexts')?.sourceFile !==
      leafContextsFile ||
    !/\bconst goal = buildGoalContext\(/u.test(leafContexts) ||
    !/\bgoalWorkerRuntime:\s*goal\.worker\b/u.test(composition)
  ) {
    return undefined
  }

  const goalBuild = read(join(ROOT, goalBuildFile))
  const constantName =
    /programMaintenance:\s*Object\.freeze\(\{[\s\S]{0,300}?\bjobName:\s*([A-Z][A-Z0-9_]*)\b/u.exec(
      goalBuild,
    )?.[1]
  if (!constantName) return undefined
  const target = importMap(goalBuildFile).get(constantName)
  return target ? resolveJobConstant(target.constName, target.sourceFile) : undefined
}

type DiscoveredJobs = Readonly<{
  /** Job names resolved from production-reachable worker registrations. */
  names: ReadonlyArray<string>
  /** Registration gate: job name → capability (registerCapabilityGatedJob). */
  registrationGates: ReadonlyMap<string, string>
  /** In-handler gates: job file → capabilities asserted inside the handler. */
  handlerGates: ReadonlyMap<string, ReadonlyArray<string>>
}>

/** In-handler capability gates asserted inside each production `.job.ts`. */
function discoverHandlerGates(): ReadonlyMap<string, ReadonlyArray<string>> {
  const handlerGates = new Map<string, string[]>()
  const jobFiles = walk(join(ROOT, 'src')).filter(
    (f) => f.endsWith('.job.ts') && !f.endsWith('.test.ts'),
  )
  for (const abs of jobFiles) {
    const content = read(abs)
    const gates = [
      ...content.matchAll(
        /(?:isCapabilityJobEnabled|assertBetaCapability|checkGlobalCapability)\(\s*(?:\w+,\s*)?'([^']+)'/g,
      ),
    ].map((m) => m[1])
    if (gates.length > 0) handlerGates.set(rel(abs), gates)
  }
  return handlerGates
}

/** Resolve one registration reference to the job name it registers. */
function resolveRegisteredJobName(
  reference: JobRegistrationReference,
  registrationSource: string,
  imports: ReadonlyMap<string, { constName: string; sourceFile: string }>,
): string | undefined {
  if (reference.literal) return reference.literal
  if (reference.identifier) {
    const target = imports.get(reference.identifier)
    return target ? resolveJobConstant(target.constName, target.sourceFile) : undefined
  }
  return resolveContextOwnedJobName(registrationSource, reference.contextOwnedFacade)
}

type FileJobRegistrations = Readonly<{
  names: ReadonlyArray<string>
  gates: ReadonlyArray<readonly [string, string]>
}>

/** Job names, and capability gates, registered by one registration file. */
function jobRegistrationsIn(registrationFile: string): FileJobRegistrations {
  const source = read(join(ROOT, registrationFile))
  const imports = importMap(registrationFile)
  const names: string[] = []
  const gates: (readonly [string, string])[] = []
  for (const reference of extractJobRegistrationReferences(source)) {
    const name = resolveRegisteredJobName(reference, source, imports)
    if (name) names.push(name)
  }
  for (const m of source.matchAll(
    /registerCapabilityGatedJob\(\s*(?:'([^']+)'|([A-Z][A-Z0-9_]+)|((?:\w+\.)*\w+)\.jobName)\s*,\s*'([^']+)'/g,
  )) {
    const name = resolveRegisteredJobName(
      { literal: m[1], identifier: m[2], contextOwnedFacade: m[3] },
      source,
      imports,
    )
    if (name) {
      names.push(name)
      gates.push([name, m[4]])
    }
  }
  return { names, gates }
}

/**
 * Job names the root bootstrap registers through the `JOB_NAMES` record rather
 * than through a registration reference.
 */
function bootstrapJobNames(): ReadonlyArray<string> {
  const bootstrap = read(join(ROOT, 'src/bootstrap.ts'))
  if (!/jobRegistry\.register\(jobName,/u.test(bootstrap)) return []
  const record = resolveJobConstant(
    'JOB_NAMES',
    'src/contexts/metric/infrastructure/jobs/refresh-materialized-view.job.ts',
  )
  if (!record) return []
  const names: string[] = []
  for (const m of bootstrap.matchAll(/JOB_NAMES\.(\w+)/g)) {
    const value = new RegExp(`${m[1]}:\\s*'([^']+)'`).exec(record)?.[1]
    if (value) names.push(value)
  }
  return names
}

function discoverJobs(): DiscoveredJobs {
  const handlerGates = discoverHandlerGates()
  const names = new Set<string>()
  const registrationGates = new Map<string, string>()
  for (const registrationFile of productionJobRegistrationFiles()) {
    const registrations = jobRegistrationsIn(registrationFile)
    for (const name of registrations.names) names.add(name)
    for (const [name, gate] of registrations.gates) registrationGates.set(name, gate)
  }
  for (const name of bootstrapJobNames()) names.add(name)
  return { names: [...names].sort(), registrationGates, handlerGates }
}

/**
 * Root bootstrap remains the worker entry point, but a context may own the
 * construction and registration of its handlers. Follow only exported worker
 * registrars that are themselves reachable from production composition.
 */
function productionJobRegistrationFiles(): ReadonlyArray<string> {
  const files = new Set<string>(['src/bootstrap.ts'])
  for (const abs of walk(join(ROOT, 'src/contexts')).filter(isTsNonTest)) {
    const file = rel(abs)
    const source = read(abs)
    const registrar =
      /export (?:async )?(?:const|function) (register\w*WorkerJobs)\b/u.exec(source)?.[1]
    if (
      registrar &&
      registrationCallSites(registrar, file).some((callSite) =>
        isProductionCompositionFile(callSite),
      )
    ) {
      files.add(file)
    }
  }
  return [...files].sort()
}

// ── 4. Consumers ────────────────────────────────────────────────────

type DiscoveredConsumer = Readonly<{
  file: string
  tags: ReadonlyArray<string>
  durable: boolean
  registrationFunction: string
  compositionFiles: ReadonlyArray<string>
}>

function registrationCallSites(
  registrationFunction: string,
  definitionFile: string,
): readonly string[] {
  const call = new RegExp(`\\b${registrationFunction}\\s*\\(`, 'u')
  return walk(join(ROOT, 'src'))
    .filter(isTsNonTest)
    .map(rel)
    .filter((file) => file !== definitionFile)
    .filter((file) => call.test(read(join(ROOT, file))))
    .sort()
}

const PRODUCTION_COMPOSITION_ROOTS = new Set([
  'src/bootstrap.ts',
  // ARC-03-T10: the Metric/Goal/Dashboard/Activity/Notification builds moved
  // out of the root into this module, so it is a composition root too.
  'src/composition/read-and-notify-contexts.ts',
  'src/composition.ts',
  'src/worker/index.ts',
])

function isProductionCompositionFile(
  file: string,
  visited: ReadonlySet<string> = new Set(),
): boolean {
  if (PRODUCTION_COMPOSITION_ROOTS.has(file)) return true
  if (visited.has(file) || !file.endsWith('/build.ts')) return false

  const source = read(join(ROOT, file))
  const buildFunction = /export (?:const|function) (build[A-Za-z0-9_]+)/u.exec(
    source,
  )?.[1]
  if (!buildFunction) return false

  const nextVisited = new Set(visited)
  nextVisited.add(file)
  return registrationCallSites(buildFunction, file).some((callSite) =>
    isProductionCompositionFile(callSite, nextVisited),
  )
}

function discoverConsumers(): ReadonlyArray<DiscoveredConsumer> {
  const out: DiscoveredConsumer[] = []
  const files = walk(join(ROOT, 'src/contexts')).filter((f) => !f.endsWith('.test.ts'))
  for (const abs of files) {
    const file = rel(abs)
    const source = read(abs)
    const registrationFunction =
      /export (?:const|function) (register[A-Za-z0-9_]+)/u.exec(source)?.[1]
    if (
      /\/infrastructure\/event-handlers\/(?:index|[^/]+-event-handlers)\.ts$/.test(file)
    ) {
      const tags = [
        ...new Set([...source.matchAll(/\.on\(\s*'([^']+)'/g)].map((m) => m[1])),
      ]
      if (registrationFunction) {
        out.push({
          file,
          tags,
          durable: false,
          registrationFunction,
          compositionFiles: registrationCallSites(registrationFunction, file).filter(
            (callSite) => isProductionCompositionFile(callSite),
          ),
        })
      }
    } else if (/outbox-consumers\.ts$/.test(file)) {
      const tags = discoverDurableEventTags(source)
      if (registrationFunction) {
        out.push({
          file,
          tags,
          durable: true,
          registrationFunction,
          compositionFiles: registrationCallSites(registrationFunction, file).filter(
            (callSite) => isProductionCompositionFile(callSite),
          ),
        })
      }
    }
  }
  return out
}

function discoverDurableEventTags(source: string): ReadonlyArray<string> {
  const tags = new Set(
    [...source.matchAll(/eventType:\s*'([^']+)'/g)].map((match) => match[1]),
  )

  // A one-event consumer may use a local literal constant so parsing and
  // registration share one discriminator. Resolve that constant without
  // treating an arbitrary computed event type as governed wiring.
  for (const match of source.matchAll(/eventType:\s*([A-Z][A-Z0-9_]*)\b/g)) {
    const value = new RegExp(
      `(?:export\\s+)?const\\s+${match[1]}\\s*=\\s*'([^']+)'`,
    ).exec(source)?.[1]
    if (value) tags.add(value)
  }

  for (const loop of source.matchAll(
    /for\s*\(\s*const\s+(\w+)\s+of\s+(\w+)\s*\)\s*\{[\s\S]*?registerConsumer\(\{\s*eventType\s*(?::\s*(\w+))?\s*,/g,
  )) {
    const [eventVariable, arrayName] = loop.slice(1, 3)
    const registeredVariable = loop[3] ?? 'eventType'
    if (eventVariable !== registeredVariable) continue
    const array = new RegExp(
      `export const ${arrayName}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\s*as const\\)`,
    ).exec(source)
    if (!array) continue
    for (const event of array[1].matchAll(/'([^']+)'/g)) tags.add(event[1])
  }

  return [...tags]
}

/** Files making registerConsumer({ ... }) calls (durable registration). */
function durableRegistrationFiles(): ReadonlyArray<string> {
  return walk(join(ROOT, 'src'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .filter((f) => /registerConsumer\(\s*\{/.test(read(f)))
    .map(rel)
    .sort()
}

// ── 5. Schedules ────────────────────────────────────────────────────

function discoverSchedules(): ReadonlyArray<string> {
  return JOB_OPERATIONAL_CONTRACTS.filter(({ schedule }) => schedule !== 'none')
    .map(({ jobName }) => `${jobName}-recurring`)
    .sort()
}

// ── 6. Operator commands ────────────────────────────────────────────

const OPERATOR_SCRIPT_PREFIX = /^(seed|simulate|db:|auth:|audit:|perf:|bqc:|ops:)/

function discoverOperatorFiles(): ReadonlyArray<string> {
  return (
    walk(join(ROOT, 'scripts'))
      .filter((f) => /\.(ts|mts|mjs|py|sql)$/.test(f))
      // A colocated test is not an operator command. Every other discovery
      // function in this file already excludes tests (:149, :231, :280, :297);
      // this one did not, purely because nothing had ever put a test under
      // scripts/ — so the first one to do so would have been told to catalogue
      // its own test file as an operator entry point.
      .filter((f) => !/\.test\.(ts|mts|mjs)$/.test(f))
      .map(rel)
      .sort()
  )
}

function operatorPackageScripts(): ReadonlyArray<{ name: string; file?: string }> {
  const pkg = JSON.parse(read(join(ROOT, 'package.json'))) as {
    scripts: Record<string, string>
  }
  return Object.entries(pkg.scripts)
    .filter(([name]) => OPERATOR_SCRIPT_PREFIX.test(name))
    .map(([name, cmd]) => ({
      name,
      file: /(?:tsx|node|-f)\s+(scripts\/[^\s'"]+)/.exec(cmd)?.[1],
    }))
}

// ── Shared assertions ───────────────────────────────────────────────

const catalogue = ENTRY_POINT_CATALOGUE
const byKind = (kind: EntryPointRow['kind']) => catalogue.filter((r) => r.kind === kind)
const rowKey = (r: Pick<EntryPointRow, 'kind' | 'name' | 'file'>) =>
  `${r.kind} | ${r.name} | ${r.file}`

const isSystemAction = (action: string): boolean => action.startsWith('system:')

describe('BQC-2.1 entry-point catalogue', () => {
  it('discovers both request handlers and server-only implementation boundaries', () => {
    const discovered = discoverServerFunctionDeclarations(
      `
        export const internalHandler = createServerOnlyFn(
          async () => ({ ok: true }),
        )
        export const publicHandler = createServerFn({ method: 'POST' })
          .handler(internalHandler)
      `,
      'fixture/server-boundaries.ts',
    )

    expect(discovered.map(({ name, method }) => ({ name, method }))).toEqual([
      { name: 'internalHandler', method: 'SERVER_ONLY' },
      { name: 'publicHandler', method: 'POST' },
    ])
  })

  it('does not mistake a job-name declaration for a runtime registration', () => {
    const references = extractJobRegistrationReferences(`
      export const ORPHAN_JOB_NAME = 'declared-only'
      registry.register('literal-job', handler)
      registerCapabilityGatedJob(COMPOSED_JOB_NAME, 'goal.use', handler)
    `)

    expect(references).toEqual([
      { literal: 'literal-job', identifier: undefined },
      { literal: undefined, identifier: 'COMPOSED_JOB_NAME' },
    ])
  })

  it('has complete, well-formed rows with unique ids', () => {
    const ids = catalogue.map((r) => r.id)
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(dupes, `duplicate row ids: ${dupes.join(', ')}`).toEqual([])

    const bad = catalogue.filter(
      (r) =>
        r.id !== `${r.kind}:${r.name}` ||
        !r.name ||
        !r.file ||
        !r.action ||
        !r.purpose ||
        r.principals.length === 0,
    )
    expect(bad.map(rowKey), `malformed rows: ${bad.map(rowKey).join(', ')}`).toEqual([])
  })

  it('leaves no unresolved declared-only or retired Recognition consumer', () => {
    const declaredOnly = byKind('consumer').filter(
      ({ registration }) => registration.reachability === 'declared_only',
    )
    expect(
      declaredOnly.map(rowKey),
      `unresolved declared-only consumers: ${declaredOnly.map(rowKey).join(', ')}`,
    ).toEqual([])

    for (const retiredName of [
      'goal.event-handlers',
      'badge.event-handlers',
      'leaderboard.event-handlers',
    ]) {
      expect(
        byKind('consumer').find(({ name }) => name === retiredName),
        retiredName,
      ).toBeUndefined()
    }
    expect(
      catalogue.some(
        ({ registration }) => String(registration.reachability) === 'blocked_declaration',
      ),
    ).toBe(false)
  })

  it('classifies ownership and every write path without changing stable order', () => {
    expect(validateEntryPointGovernance(catalogue)).toEqual([])
    const orderedDigest = (rows: readonly EntryPointRow[]) =>
      createHash('sha256')
        .update(rows.map((entry) => `${entry.id}|${entry.file}`).join('\n'))
        .digest('hex')
    // Both digests are asserted TOGETHER, as one object, deliberately.
    //
    // As two separate `expect`s the first throw aborted the test and the second
    // digest was never evaluated — so adding one catalogue row cost two full
    // runs of a 5-second suite: fix digest A, re-run, discover digest B, fix it,
    // re-run. Measured on 2026-08-31 while registering `scripts/ci/gate.ts`.
    //
    // Compared as an object, one run prints both actual values and the
    // `Received` block is literally what you paste back in. Same assertion,
    // same strictness, half the cycles.
    expect({
      full: orderedDigest(catalogue),
      withoutOutboxConsumers: orderedDigest(
        catalogue.filter(
          ({ id }) => id !== 'consumer:notification.workflow-outbox-consumers',
        ),
      ),
    }).toEqual({
      full: 'abe84771d5fac1ab01427ac885599a68a92cfd55e4d2c28f386beb2257ad8b6d',
      withoutOutboxConsumers:
        '038d3382d5d3f1b2b2186f2cfa6ba202902a1ac48ac973772c3ccfc6d593ad1a',
    })

    const invalid = {
      ...catalogue[0],
      owner: '',
      mutation: {
        kind: 'mutation',
        stateOwner: '',
        disposition: 'temporarily_accepted_debt',
        reason: '',
        debtOwner: '',
        expiresAt: 'not-a-date',
      },
    }
    expect(validateEntryPointGovernance([invalid])).toEqual([
      `${catalogue[0]!.id}: owner is missing`,
      `${catalogue[0]!.id}: mutation state owner is missing`,
      `${catalogue[0]!.id}: mutation reason is missing`,
      `${catalogue[0]!.id}: debt owner is missing`,
      `${catalogue[0]!.id}: debt expiry is invalid`,
    ])

    const invalidVocabulary = {
      ...catalogue[0],
      owner: 'invented-context',
      registration: {
        ...catalogue[0]!.registration,
        reachability: 'assumed-live',
      },
      mutation: {
        kind: 'mutation',
        stateOwner: 'invented-context',
        disposition: 'local_only_with_reason',
        reason: 'fixture',
      },
    }
    expect(validateEntryPointGovernance([invalidVocabulary])).toEqual([
      `${catalogue[0]!.id}: owner is invalid`,
      `${catalogue[0]!.id}: registration reachability is invalid`,
      `${catalogue[0]!.id}: mutation state owner is invalid`,
    ])
  })

  it('records the foundation apply branch as an external Railway effect', () => {
    expect(
      catalogue.find(
        ({ kind, name }) =>
          kind === 'operator_command' &&
          name === 'scripts/release/railway-data-cell-foundation.ts',
      ),
    ).toMatchObject({
      externalEffect: true,
      mutation: {
        kind: 'mutation',
        stateOwner: 'operations',
        disposition: 'local_only_with_reason',
      },
    })
  })

  it('records the custom-domain ceremony as an external Railway effect', () => {
    expect(
      catalogue.find(
        ({ kind, name }) =>
          kind === 'operator_command' &&
          name === 'scripts/release/railway-data-cell-domain.ts',
      ),
    ).toMatchObject({
      externalEffect: true,
      mutation: {
        kind: 'mutation',
        stateOwner: 'operations',
        disposition: 'local_only_with_reason',
      },
    })
  })

  it('records Google Content approval activation as an external Railway effect', () => {
    expect(
      catalogue.find(
        ({ kind, name }) =>
          kind === 'operator_command' &&
          name === 'scripts/release/railway-google-content-approval-activation.ts',
      ),
    ).toMatchObject({
      externalEffect: true,
      mutation: {
        kind: 'mutation',
        stateOwner: 'operations',
        disposition: 'local_only_with_reason',
      },
    })
  })

  it('keeps Google approval signing outside Railway mutation authority', () => {
    const signer = read(join(ROOT, 'scripts/ops/google-content-approval-sign.ts'))
    const validator = read(join(ROOT, 'scripts/ops/google-content-approval.ts'))

    expect(signer).toContain('--railway-environment is retired')
    expect(signer).toContain('--apply is blocked before any database write')
    expect(signer).not.toMatch(/spawnSync\(\s*['"]railway['"]/u)
    expect(signer).not.toContain('railway up --service')
    expect(validator).toContain('--apply is blocked before approval installation')
    expect(validator).not.toContain('installApproval(')
  })

  it('records the eleven Portal command-store transactions as atomic state-and-fact writes', () => {
    const atomicCommands = new Set([
      'createPortalGroup',
      'updatePortalGroup',
      'addPortalToGroup',
      'removePortalFromGroup',
      'createLink',
      'reorderLinks',
      'createLinkCategory',
      'reorderCategories',
      'issuePortalToken',
      'rotatePortalToken',
      'revokePortalTokens',
    ])
    const rows = catalogue.filter(
      ({ kind, name }) => kind === 'server_function' && atomicCommands.has(name),
    )

    expect(rows).toHaveLength(11)
    expect(rows.map(({ mutation }) => mutation)).toEqual(
      Array.from({ length: 11 }, () =>
        expect.objectContaining({
          kind: 'mutation',
          stateOwner: 'portal',
          disposition: 'atomic_state_and_fact',
        }),
      ),
    )
  })

  it('classifies the established Portal lifecycle, publication, and upload seams from their owning transactions', () => {
    const atomicCommands = new Set([
      'createPortal',
      'updatePortal',
      'rollbackPortalPublication',
      'completeContentReview',
      'deletePortal',
      'finalizeUpload',
    ])
    const atomicRows = catalogue.filter(
      ({ kind, name }) => kind === 'server_function' && atomicCommands.has(name),
    )

    expect(atomicRows).toHaveLength(6)
    expect(atomicRows.map(({ mutation }) => mutation)).toEqual(
      Array.from({ length: 6 }, () =>
        expect.objectContaining({
          kind: 'mutation',
          stateOwner: 'portal',
          disposition: 'atomic_state_and_fact',
        }),
      ),
    )

    expect(
      catalogue.find(
        ({ kind, name }) => kind === 'server_function' && name === 'requestUploadUrl',
      )?.mutation,
    ).toMatchObject({
      kind: 'mutation',
      stateOwner: 'portal',
      disposition: 'local_only_with_reason',
    })
  })

  it('classifies every Guest write by its command/observation transaction or session-only effect', () => {
    const atomicCommands = new Set([
      'submitGuestResponseFn',
      'correctGuestResponseFn',
      'submitPrivateFeedbackFn',
      'withdrawPrivateFeedbackFn',
      'selectGoogleReviewFn',
      'selectSecondaryLinkFn',
      'withdrawGuestResponseFn',
      'moderateGuestResponseFn',
      'recordScanFn',
    ])
    const atomicRows = catalogue.filter(
      ({ kind, name }) => kind === 'server_function' && atomicCommands.has(name),
    )

    expect(atomicRows).toHaveLength(9)
    expect(atomicRows.map(({ mutation }) => mutation)).toEqual(
      Array.from({ length: 9 }, () =>
        expect.objectContaining({
          kind: 'mutation',
          stateOwner: 'guest',
          disposition: 'atomic_state_and_fact',
        }),
      ),
    )
    expect(
      catalogue.find(
        ({ kind, name }) =>
          kind === 'server_function' && name === 'startNewGuestResponseFn',
      )?.mutation,
    ).toMatchObject({
      kind: 'mutation',
      stateOwner: 'guest',
      disposition: 'local_only_with_reason',
    })
  })

  it('classifies Review publication writes by their command-store fact boundary', () => {
    const atomic = new Set([
      'submitReplyFn',
      'approveReplyFn',
      'editPublishedReplyFn',
      'rejectReplyFn',
      'retryPublishFn',
    ])
    const local = new Set(['draftReplyFn', 'deleteReplyFn'])
    const rows = catalogue.filter(
      ({ kind, name }) =>
        kind === 'server_function' && (atomic.has(name) || local.has(name)),
    )

    expect(rows).toHaveLength(7)
    for (const row of rows) {
      expect(row.mutation).toMatchObject({
        kind: 'mutation',
        stateOwner: 'review',
        disposition: atomic.has(row.name)
          ? 'atomic_state_and_fact'
          : 'local_only_with_reason',
      })
    }
  })

  it('classifies Inbox workflow facts separately from the private visit watermark', () => {
    const local = 'stampLastInboxViewFn'
    const atomic = new Set([
      'assignInboxItemFn',
      'bulkAssignInboxItemsFn',
      'addInboxNoteFn',
      'updateInboxStatusFn',
      'bulkUpdateInboxStatusFn',
      'escalateInboxItemFn',
    ])
    const rows = catalogue.filter(
      ({ kind, name }) =>
        kind === 'server_function' && (name === local || atomic.has(name)),
    )

    expect(rows).toHaveLength(7)
    for (const row of rows) {
      expect(row.mutation).toMatchObject({
        kind: 'mutation',
        stateOwner: 'inbox',
        disposition:
          row.name === local ? 'local_only_with_reason' : 'atomic_state_and_fact',
      })
    }
  })

  it('classifies recipient Notification controls as context-local projection state', () => {
    const names = new Set([
      'markNotificationReadFn',
      'markNotificationUnreadFn',
      'markAllNotificationsReadFn',
      'dismissAllNotificationsFn',
      'dismissNotificationFn',
      'updateNotificationPreferenceFn',
      'muteNotificationCategoryFn',
      'updateNotificationUserSettingsFn',
    ])
    const rows = catalogue.filter(
      ({ kind, name }) => kind === 'server_function' && names.has(name),
    )

    expect(rows).toHaveLength(names.size)
    expect(rows.map(({ mutation }) => mutation)).toEqual(
      Array.from({ length: names.size }, () =>
        expect.objectContaining({
          kind: 'mutation',
          stateOwner: 'notification',
          disposition: 'local_only_with_reason',
        }),
      ),
    )
  })

  it('classifies every current job and consumer without delayed mutation debt', () => {
    const delayedWrites = catalogue.filter(
      ({ kind, mutation }) =>
        (kind === 'job' || kind === 'consumer') && mutation.kind === 'mutation',
    )
    const debt = delayedWrites.filter(
      ({ mutation }) =>
        mutation.kind === 'mutation' &&
        mutation.disposition === 'temporarily_accepted_debt',
    )

    expect(
      debt.map(rowKey),
      `delayed mutation debt: ${debt.map(rowKey).join(', ')}`,
    ).toEqual([])
    expect(
      delayedWrites.filter(
        ({ mutation }) =>
          mutation.kind === 'mutation' &&
          mutation.disposition === 'atomic_state_and_fact',
      ),
    ).toHaveLength(28)
    expect(
      delayedWrites.filter(
        ({ mutation }) =>
          mutation.kind === 'mutation' &&
          mutation.disposition === 'local_only_with_reason',
      ),
    ).toHaveLength(44)
  })

  it('classifies every request boundary and exposes the remaining split-write defects', () => {
    const requestRows = catalogue.filter(({ kind }) =>
      ['server_function', 'route_api', 'route_ui'].includes(kind),
    )
    const debt = requestRows.filter(
      ({ mutation }) =>
        mutation.kind === 'mutation' &&
        mutation.disposition === 'temporarily_accepted_debt',
    )
    expect(
      debt.map(rowKey),
      `request mutation debt: ${debt.map(rowKey).join(', ')}`,
    ).toEqual([])

    const defects = requestRows
      .filter(
        ({ mutation }) =>
          mutation.kind === 'mutation' && mutation.disposition === 'non_atomic_defect',
      )
      .map(({ id }) => id)
      .sort()
    expect(defects).toEqual([])
  })

  it('does not hide write-on-read diagnostics or fail-closed no-effect boundaries', () => {
    expect(
      catalogue.find(({ id }) => id === 'server_function:getRegionDiagnosticFn')
        ?.mutation,
    ).toMatchObject({
      kind: 'mutation',
      stateOwner: 'identity',
      disposition: 'local_only_with_reason',
    })
    expect(
      catalogue.find(({ id }) => id === 'server_function:deleteProperty')?.mutation,
    ).toEqual({ kind: 'read_only' })
    expect(
      catalogue.find(({ id }) => id === 'server_function:registerUserAndOrg')?.mutation,
    ).toEqual({ kind: 'read_only' })
    expect(
      catalogue.find(({ id }) => id === 'server_function:createOrganizationFn')?.mutation,
    ).toEqual({ kind: 'read_only' })
    expect(
      catalogue.find(({ id }) => id === 'route_api:/api/public/p/$token/click/$linkId')
        ?.mutation,
    ).toEqual({ kind: 'read_only' })
  })

  it('records every delayed entry point as BQC-3.2-integrated (BQC-2.5/3.2)', () => {
    const delayed = catalogue.filter((r) =>
      ['job', 'consumer', 'schedule'].includes(r.kind),
    )
    const missing = delayed.filter((r) => r.policyIntegration !== 'integrated_bqc3')
    expect(
      missing.map(rowKey),
      `delayed rows without policyIntegration 'integrated_bqc3': ${missing.map(rowKey).join(', ')}`,
    ).toEqual([])
    expect(delayed.length).toBeGreaterThan(0)
  })

  it('governs exhaustive Review Analysis enrollment recovery as an unconditional recurring job', () => {
    expect(
      catalogue.find(({ id }) => id === 'job:ai-review-analysis-enrollment-sweep'),
    ).toMatchObject({
      action: 'system:ai.review_analysis_enrollment_sweep',
      capability: 'none',
      resourceScope: 'tenant_cross',
      registration: {
        ownerFile: 'src/bootstrap.ts',
        reachability: 'boot_registry',
      },
      mutation: {
        kind: 'mutation',
        stateOwner: 'shared',
        disposition: 'atomic_state_and_fact',
      },
    })
    expect(
      catalogue.find(
        ({ id }) => id === 'schedule:ai-review-analysis-enrollment-sweep-recurring',
      ),
    ).toMatchObject({
      action: 'system:ai.review_analysis_enrollment_sweep',
      capability: 'none',
      resourceScope: 'tenant_cross',
    })
  })

  it('records the registration owner and strongest observable reachability', () => {
    for (const row of catalogue) {
      if (row.kind === 'job') {
        expect(row.registration, row.id).toEqual({
          ownerFile: 'src/bootstrap.ts',
          reachability: 'boot_registry',
        })
      } else if (row.kind === 'schedule') {
        expect(row.registration, row.id).toEqual({
          ownerFile: 'src/worker/index.ts',
          reachability: 'source_composed',
        })
      }
    }
    expect(read(join(ROOT, 'src/shared/jobs/readiness.ts'))).toContain(
      'registry.getAll()',
    )
  })

  it('derives every row posture from the authoritative capability sets', () => {
    const bad = catalogue.filter(
      (r) => r.betaPosture !== postureForCapability(r.capability),
    )
    expect(bad.map(rowKey), `posture drift: ${bad.map(rowKey).join(', ')}`).toEqual([])
  })

  it('has no stale rows (every row file exists)', () => {
    const missing = catalogue.filter((r) => !existsSync(join(ROOT, r.file)))
    expect(
      missing.map(rowKey),
      `rows whose file does not exist: ${missing.map(rowKey).join(', ')}`,
    ).toEqual([])
  })

  it('covers every server function and pins its authz to the code', () => {
    const discovered = discoverServerFunctions()
    const rows = byKind('server_function')

    const missing = discovered.filter(
      (d) => !rows.some((r) => r.name === d.name && r.file === d.file),
    )
    expect(
      missing.map((d) => `${d.name} (${d.file})`),
      `server functions missing from the catalogue:\n  ${missing.map((d) => `${d.name} (${d.file})`).join('\n  ')}`,
    ).toEqual([])

    const stale = rows.filter(
      (r) => !discovered.some((d) => d.name === r.name && d.file === r.file),
    )
    expect(
      stale.map(rowKey),
      `stale server-function rows: ${stale.map(rowKey).join(', ')}`,
    ).toEqual([])

    for (const r of rows) {
      const d = discovered.find((x) => x.name === r.name && x.file === r.file)!
      const declared = [r.action, ...(r.alsoActions ?? [])]
      const undeclared = d.actions.filter(
        (a) => !declared.includes(a as EntryPointRow['action']),
      )
      expect(
        undeclared,
        `${r.id}: code asserts ${undeclared.join(', ')} not declared in the row`,
      ).toEqual([])

      if (d.caps.length > 0) {
        expect(d.caps, `${r.id}: capability not among code assertions`).toContain(
          r.capability,
        )
        expect(
          r.canonicalOnly ?? false,
          `${r.id}: authz is checkable — not canonicalOnly`,
        ).toBe(false)
      } else if (d.actions.length > 0 && !isSystemAction(r.action)) {
        // Capability derived from the action via the ADR 0033 mapping.
        expect(
          r.capability,
          `${r.id}: capability must equal capabilityForPermission('${r.action}')`,
        ).toBe(capabilityForPermission(r.action as Permission))
        expect(
          r.canonicalOnly ?? false,
          `${r.id}: authz is checkable — not canonicalOnly`,
        ).toBe(false)
      } else {
        expect(
          r.canonicalOnly,
          `${r.id}: no mechanically checkable authz — row must set canonicalOnly: true`,
        ).toBe(true)
      }
    }
  })

  it('covers every route (UI + API)', () => {
    const discovered = discoverRoutes()
    const rows = catalogue.filter((r) => r.kind === 'route_ui' || r.kind === 'route_api')

    const missing = discovered.filter(
      (d) =>
        !rows.some((r) => r.name === d.name && r.file === d.file && r.kind === d.kind),
    )
    expect(
      missing.map((d) => `${d.kind} ${d.name} (${d.file})`),
      `routes missing from the catalogue:\n  ${missing.map((d) => `${d.kind} ${d.name} (${d.file})`).join('\n  ')}`,
    ).toEqual([])

    const stale = rows.filter(
      (r) =>
        !discovered.some(
          (d) => d.name === r.name && d.file === r.file && d.kind === r.kind,
        ),
    )
    expect(
      stale.map(rowKey),
      `stale route rows: ${stale.map(rowKey).join(', ')}`,
    ).toEqual([])
  })

  it('covers every BullMQ job and pins its capability gate', () => {
    const discovered = discoverJobs()
    const rows = byKind('job')

    const missing = discovered.names.filter((n) => !rows.some((r) => r.name === n))
    expect(missing, `jobs missing from the catalogue: ${missing.join(', ')}`).toEqual([])

    const stale = rows.filter((r) => !discovered.names.includes(r.name))
    expect(stale.map(rowKey), `stale job rows: ${stale.map(rowKey).join(', ')}`).toEqual(
      [],
    )

    for (const r of rows) {
      const registrationGate = discovered.registrationGates.get(r.name)
      const handlerGates = r.file.endsWith('.job.ts')
        ? (discovered.handlerGates.get(r.file) ?? [])
        : []
      const effective = registrationGate ?? handlerGates[0]
      if (effective !== undefined) {
        expect(
          r.capability,
          `${r.id}: capability gate drift (code has '${effective}')`,
        ).toBe(effective)
      } else if (r.policyIntegration !== 'integrated_bqc3') {
        expect(
          r.capability,
          `${r.id}: no code gate and not BQC-3.2-integrated — capability must be 'none'`,
        ).toBe('none')
      }
      // BQC-3.2-integrated rows carry no code-level gate: the capability is the
      // canonical ASSIGNMENT consumed by the dispatch gate
      // (src/shared/jobs/delayed-execution-gate.ts) — pinned by the gate tests
      // and the BQC-2.5 contract fixtures instead.
    }
  })

  it('covers every event consumer module with exact event tags', () => {
    const discovered = discoverConsumers()
    const rows = byKind('consumer')

    const missing = discovered.filter((d) => !rows.some((r) => r.file === d.file))
    expect(
      missing.map((d) => d.file),
      `consumer modules missing from the catalogue: ${missing.map((d) => d.file).join(', ')}`,
    ).toEqual([])

    const stale = rows.filter((r) => !discovered.some((d) => d.file === r.file))
    expect(
      stale.map(rowKey),
      `stale consumer rows: ${stale.map(rowKey).join(', ')}`,
    ).toEqual([])

    for (const r of rows) {
      const d = discovered.find((x) => x.file === r.file)!
      expect(
        [...(r.eventTags ?? [])].sort(),
        `${r.id}: eventTags must match the registration table`,
      ).toEqual([...d.tags].sort())
      expect(r.registration, r.id).toEqual(
        d.compositionFiles.length > 0
          ? {
              ownerFile: d.compositionFiles[0],
              reachability: 'source_composed',
            }
          : { ownerFile: d.file, reachability: 'declared_only' },
      )
    }

    // Durable registration calls may only happen in discovered consumer modules.
    // The registry defines the function but does not register handlers itself.
    const allowed = new Set(discovered.filter((d) => d.durable).map((d) => d.file))
    const offenders = durableRegistrationFiles().filter((f) => !allowed.has(f))
    expect(
      offenders,
      `registerConsumer calls outside catalogued modules: ${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('covers every recurring schedule registered in the worker', () => {
    const discovered = discoverSchedules()
    const rows = byKind('schedule')

    const missing = discovered.filter((n) => !rows.some((r) => r.name === n))
    expect(
      missing,
      `schedules missing from the catalogue: ${missing.join(', ')}`,
    ).toEqual([])

    const stale = rows.filter((r) => !discovered.includes(r.name))
    expect(
      stale.map(rowKey),
      `stale schedule rows: ${stale.map(rowKey).join(', ')}`,
    ).toEqual([])

    const worker = read(join(ROOT, 'src/worker/index.ts'))
    expect(worker).toContain('createOperationalSchedulerPlan()')
    expect(worker).not.toMatch(/planSchedule\(\s*\{\s*jobName:/)
  })

  it('covers every operator command (scripts/ + package.json operators)', () => {
    const rows = byKind('operator_command')

    const missingFiles = discoverOperatorFiles().filter(
      (f) => !rows.some((r) => r.file === f),
    )
    expect(
      missingFiles,
      `operator scripts missing from the catalogue:\n  ${missingFiles.join('\n  ')}`,
    ).toEqual([])

    const stale = rows.filter(
      (r) => r.file !== 'package.json' && !discoverOperatorFiles().includes(r.file),
    )
    expect(
      stale.map(rowKey),
      `stale operator rows: ${stale.map(rowKey).join(', ')}`,
    ).toEqual([])

    const uncovered = operatorPackageScripts().filter(
      (s) =>
        !(s.file && rows.some((r) => r.file === s.file)) &&
        !rows.some((r) => r.name === s.name && r.file === 'package.json'),
    )
    expect(
      uncovered.map((s) => s.name),
      `package.json operator scripts without a row: ${uncovered.map((s) => s.name).join(', ')}`,
    ).toEqual([])
  })

  it('confines the public surface to the declared capabilities', () => {
    const PUBLIC_SURFACE: ReadonlyArray<Capability | 'none'> = [
      'portal.read',
      'portal.public_read',
      'portal.guest_response',
      'portal.guest_text',
      'portal.guest_contact',
      'portal.guest_media',
      'notification.send_email',
      'identity.register',
      'organization.create',
      'none',
    ]
    const offenders = catalogue.filter(
      (r) => r.principals.includes('public') && !PUBLIC_SURFACE.includes(r.capability),
    )
    expect(
      offenders.map(rowKey),
      `public entry points with capabilities outside the declared public surface:\n  ${offenders.map(rowKey).join('\n  ')}`,
    ).toEqual([])
  })

  it('pins blocked-capability rows to hard-deny and core rows to allow (policy test)', () => {
    const ctx: AuthContext = {
      userId: userId('catalogue-probe-user'),
      organizationId: organizationId('catalogue-probe-org'),
      role: 'AccountAdmin',
    }
    for (const r of catalogue) {
      if (r.capability === 'none') continue
      const decision = checkBetaCapability(ctx, r.capability)
      if (isBlockedCapability(r.capability)) {
        expect(
          decision.allowed,
          `${r.id}: blocked capability '${r.capability}' must deny`,
        ).toBe(false)
        expect(decision.reason).toBe('capability_blocked')
      } else if (r.betaPosture === 'non_core') {
        expect(
          decision.allowed,
          `${r.id}: non-core capability '${r.capability}' must deny without allowlist`,
        ).toBe(false)
      } else {
        expect(
          decision.allowed,
          `${r.id}: core capability '${r.capability}' must allow`,
        ).toBe(true)
      }
    }
  })

  beforeEach(() => {
    resetCapabilityPolicyStore()
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
  })

  afterEach(() => {
    resetCapabilityPolicyStore()
  })
})
