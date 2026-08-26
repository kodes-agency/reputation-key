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
//   3. jobs — actual bootstrap.ts registry/gated registrations, including
//      imported constants, dynamic-import aliases, and composed metric loops
//   4. consumers — registration tables plus the production composition call
//      site (or an explicit declared-only classification)
//   5. schedules — worker/index.ts backgroundQueue.add(...) jobIds, resolving
//      imported job-name constants
//   6. operator commands — scripts/ file walk + package.json script coverage
//
// The policy test: every row's beta posture is re-derived from the
// authoritative capability sets, and every row's capability decision is
// executed against the default (empty-env) policy store — blocked and
// non-core rows must deny, core rows must allow.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
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
}>

function extractJobRegistrationReferences(
  source: string,
): readonly JobRegistrationReference[] {
  return [
    ...source.matchAll(
      /(?:jobRegistry|registry)\.register\(\s*(?:'([^']+)'|([A-Z][A-Z0-9_]+))|registerCapabilityGatedJob\(\s*(?:'([^']+)'|([A-Z][A-Z0-9_]+))/g,
    ),
  ].map((match) => ({
    literal: match[1] ?? match[3],
    identifier: match[2] ?? match[4],
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
    const sourceFile =
      source.replace(/^#\//, 'src/') + (source.endsWith('.ts') ? '' : '.ts')
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

type DiscoveredJobs = Readonly<{
  /** Job names resolved from actual bootstrap registration calls. */
  names: ReadonlyArray<string>
  /** Registration gate: job name → capability (registerCapabilityGatedJob). */
  registrationGates: ReadonlyMap<string, string>
  /** In-handler gates: job file → capabilities asserted inside the handler. */
  handlerGates: ReadonlyMap<string, ReadonlyArray<string>>
}>

function discoverJobs(): DiscoveredJobs {
  const names = new Set<string>()
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

  const registrationGates = new Map<string, string>()
  const bootstrap = read(join(ROOT, 'src/bootstrap.ts'))
  const imports = importMap('src/bootstrap.ts')
  const resolveName = (literal?: string, ident?: string): string | undefined => {
    if (literal) return literal
    if (!ident) return undefined
    const target = imports.get(ident)
    return target ? resolveJobConstant(target.constName, target.sourceFile) : undefined
  }
  for (const reference of extractJobRegistrationReferences(bootstrap)) {
    const name = resolveName(reference.literal, reference.identifier)
    if (name) names.add(name)
  }
  for (const m of bootstrap.matchAll(
    /registerCapabilityGatedJob\(\s*(?:'([^']+)'|(\w+))\s*,\s*'([^']+)'/g,
  )) {
    const name = resolveName(m[1], m[2])
    if (name) {
      names.add(name)
      registrationGates.set(name, m[3])
    }
  }
  if (/jobRegistry\.register\(jobName,/u.test(bootstrap)) {
    const record = resolveJobConstant(
      'JOB_NAMES',
      'src/contexts/metric/infrastructure/jobs/refresh-materialized-view.job.ts',
    )
    if (record) {
      for (const m of bootstrap.matchAll(/JOB_NAMES\.(\w+)/g)) {
        const value = new RegExp(`${m[1]}:\\s*'([^']+)'`).exec(record)?.[1]
        if (value) names.add(value)
      }
    }
  }
  return { names: [...names].sort(), registrationGates, handlerGates }
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
          compositionFiles: registrationCallSites(registrationFunction, file),
        })
      }
    } else if (/outbox-consumers\.ts$/.test(file)) {
      const tags = [
        ...new Set([...source.matchAll(/eventType:\s*'([^']+)'/g)].map((m) => m[1])),
      ]
      if (registrationFunction) {
        out.push({
          file,
          tags,
          durable: true,
          registrationFunction,
          compositionFiles: registrationCallSites(registrationFunction, file),
        })
      }
    }
  }
  return out
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
  const file = 'src/worker/index.ts'
  const content = read(join(ROOT, file))
  const imports = importMap(file)
  const ids = new Set<string>()

  // Standalone adds with literal jobIds.
  for (const m of content.matchAll(/jobId:\s*'([^']+)'/g)) ids.add(m[1])

  // Loop adds: `${jobName}-recurring` — resolve every jobName source.
  for (const m of content.matchAll(/jobName:\s*'([^']+)'/g)) ids.add(`${m[1]}-recurring`)
  for (const m of content.matchAll(/jobName:\s*JOB_NAMES\.(\w+)/g)) {
    const record = resolveJobConstant(
      'JOB_NAMES',
      'src/contexts/metric/infrastructure/jobs/refresh-materialized-view.job.ts',
    )
    const value = record
      ? new RegExp(`${m[1]}:\\s*'([^']+)'`).exec(record)?.[1]
      : undefined
    if (value) ids.add(`${value}-recurring`)
  }
  for (const m of content.matchAll(/jobName:\s*([A-Z][A-Z0-9_]+)\s*,/g)) {
    const target = imports.get(m[1])
    const value = target
      ? resolveJobConstant(target.constName, target.sourceFile)
      : undefined
    if (value) ids.add(`${value}-recurring`)
  }
  return [...ids].sort()
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

  it('classifies ownership and every write path without changing stable order', () => {
    expect(validateEntryPointGovernance(catalogue)).toEqual([])
    const orderedDigest = (rows: readonly EntryPointRow[]) =>
      createHash('sha256')
        .update(rows.map((entry) => `${entry.id}|${entry.file}`).join('\n'))
        .digest('hex')
    expect(orderedDigest(catalogue)).toBe(
      'fbb2e69fe9723585c411ee38d45a592a66eac092d0c1f476c0a26e5950a38bd6',
    )
    expect(
      orderedDigest(
        catalogue.filter(
          ({ id }) => id !== 'consumer:notification.workflow-outbox-consumers',
        ),
      ),
    ).toBe('cd6c4bad812cc7fa45a0011f716eb6b0e733b0ee096014ce49ee27466502232a')

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
