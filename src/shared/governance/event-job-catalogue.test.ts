// BQC-3.1 — event/job family catalogue guard test.
//
// Fails when an emitted event type or a registered BullMQ job exists without
// a family row, when a row drifts from the code (producer file, schema
// registration, consumer wiring, registration gate, schedule), or when a
// policy invariant breaks (readiness, dark containment, hygiene). This is
// the CI gate required by phase BQC-3 §3.1.
//
// Discovery is mechanical and bidirectional:
//   1. event types — `_tag: '<type>'` literals in src/contexts/*\/domain/events.ts
//   2. schema registration — `type: '<type>'` literals in schema-registrations.ts
//   3. producers — row producer files must exist and contain the type literal
//   4. consumers — `.on('<type>'` in event-handlers modules (bus) and
//      registerConsumer({ eventType, consumerName }) in outbox-consumers.ts
//   5. jobs — production-reachable register(...) /
//      registerCapabilityGatedJob(...) calls, including context-owned worker
//      registrars, with imported JOB_NAME(S) constant resolution (same
//      approach as the BQC-2.1 entry-point catalogue guard)
//   6. schedules — the single operational scheduler authority used by workers
//   7. cross-catalogue consistency with the BQC-2.1 entry-point catalogue
//
// Policy invariants: enabled event families have consumers, recorded-only
// facts are durable and consumer-free, orphan families are owned by a later
// slice, enabled jobs are actually registered, and dark/blocked posture is
// derived from the authoritative capability sets — never hand-declared.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import {
  EVENT_FAMILY_ROWS,
  JOB_FAMILY_ROWS,
  RECORDED_EVENT_RETENTION,
  type EventConsumerRef,
  type EventFamilyRow,
  type JobFamilyRow,
} from './event-job-catalogue'
import { ENTRY_POINT_CATALOGUE } from './entry-point-catalogue'
import {
  DARK_CONTEXT_CAPABILITIES,
  PORTAL_DARK_CAPABILITIES,
  listBlockedCapabilities,
} from '#/shared/auth/beta-capabilities'
import { createOperationalSchedulerPlan } from '#/shared/jobs/operational-catalogue'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import { walk } from '#/shared/testing/source-tree'

const ROOT = process.cwd()
const rel = (abs: string): string => relative(ROOT, abs)

const read = (abs: string): string => readFileSync(abs, 'utf8')
const readRel = (file: string): string => read(join(ROOT, file))

// ── Constant resolution (same approach as BQC-2.1) ──────────────────

type ImportTarget = Readonly<{ constName: string; sourceFile: string }>

/** Import map for a file: local identifier → { constName, sourceFile }. */
function importMap(file: string): Map<string, ImportTarget> {
  const content = readRel(file)
  const map = new Map<string, ImportTarget>()
  const add = (names: string, source: string) => {
    const sourceFile = `${
      source.startsWith('#/')
        ? source.replace(/^#\//, 'src/')
        : join(dirname(file), source)
    }${source.endsWith('.ts') ? '' : '.ts'}`
    for (const part of names.split(',')) {
      const p = part.trim()
      const asAlias = /(\w+)\s+as\s+(\w+)/.exec(p)
      const colonAlias = /(\w+)\s*:\s*(\w+)/.exec(p)
      if (asAlias) map.set(asAlias[2], { constName: asAlias[1], sourceFile })
      else if (colonAlias)
        map.set(colonAlias[2], { constName: colonAlias[1], sourceFile })
      else if (/^\w+$/.test(p)) map.set(p, { constName: p, sourceFile })
    }
  }
  for (const m of content.matchAll(/import \{([^}]+)\} from '([^']+)'/g)) add(m[1], m[2])
  // dynamic imports destructure into const { A, B: C } = await import(...)
  for (const m of content.matchAll(
    /const \{([^}]+)\}\s*=\s*await import\('([^']+)'\)/g,
  )) {
    add(m[1], m[2])
  }
  return map
}

/** Resolve an exported string constant to its value. */
function resolveStringConstant(
  constName: string,
  sourceFile: string,
): string | undefined {
  const m = new RegExp(`export const ${constName}\\s*=\\s*'([^']+)'`).exec(
    readRel(sourceFile),
  )
  return m?.[1]
}

/** Resolve a key inside an exported string record (e.g. JOB_NAMES.x). */
function resolveRecordConstant(
  constName: string,
  key: string,
  sourceFile: string,
): string | undefined {
  const record = new RegExp(`export const ${constName}\\s*=\\s*\\{([\\s\\S]*?)\\}`).exec(
    readRel(sourceFile),
  )
  if (!record) return undefined
  return new RegExp(`${key}:\\s*'([^']+)'`).exec(record[1])?.[1]
}

/** Resolve a jobName expression: string literal, imported constant, or JOB_NAMES key. */
function resolveJobName(
  literal: string | undefined,
  ident: string | undefined,
  recordKey: string | undefined,
  imports: Map<string, ImportTarget>,
  contextOwnedFacade?: string,
  registrationSource?: string,
): string | undefined {
  if (literal) return literal
  if (recordKey) {
    const target = imports.get('JOB_NAMES')
    return target
      ? resolveRecordConstant(target.constName, recordKey, target.sourceFile)
      : undefined
  }
  if (ident) {
    const target = imports.get(ident)
    return target ? resolveStringConstant(target.constName, target.sourceFile) : undefined
  }
  return registrationSource
    ? resolveContextOwnedJobName(registrationSource, contextOwnedFacade)
    : undefined
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

  const compositionFile = 'src/composition.ts'
  const goalBuildFile = 'src/contexts/goal/build.ts'
  const composition = readRel(compositionFile)
  const goalBuildTarget = importMap(compositionFile).get('buildGoalContext')
  if (
    goalBuildTarget?.sourceFile !== goalBuildFile ||
    !/\bconst goal = buildGoalContext\(/u.test(composition) ||
    !/\bgoalWorkerRuntime:\s*goal\.worker\b/u.test(composition)
  ) {
    return undefined
  }

  const goalBuild = readRel(goalBuildFile)
  const constantName =
    /programMaintenance:\s*Object\.freeze\(\{[\s\S]{0,300}?\bjobName:\s*([A-Z][A-Z0-9_]*)\b/u.exec(
      goalBuild,
    )?.[1]
  if (!constantName) return undefined
  const target = importMap(goalBuildFile).get(constantName)
  return target ? resolveStringConstant(target.constName, target.sourceFile) : undefined
}

// ── 1. Event type discovery ─────────────────────────────────────────

function domainEventFiles(): string[] {
  const contextsDir = join(ROOT, 'src/contexts')
  return readdirSync(contextsDir, { withFileTypes: true })
    .filter((ctx) => ctx.isDirectory())
    .map((ctx) => join(contextsDir, ctx.name, 'domain', 'events.ts'))
    .filter((abs) => existsSync(abs))
}

/** All emitted event types (`_tag` literals in domain/events.ts files). */
function discoverEventTypes(): ReadonlyArray<string> {
  const tags = new Set<string>()
  for (const abs of domainEventFiles()) {
    for (const m of read(abs).matchAll(/_tag:\s*'([^']+)'/g)) tags.add(m[1])
  }
  return [...tags].sort()
}

// ── 2. Schema registration discovery ────────────────────────────────

function discoverRegisteredTypes(): ReadonlySet<string> {
  const content = readRel('src/shared/events/schema-registrations.ts')
  return new Set([...content.matchAll(/type:\s*'([^']+)'/g)].map((m) => m[1]))
}

// ── 3. Consumer discovery ───────────────────────────────────────────

type DiscoveredConsumer = Readonly<{
  eventType: string
  module: string
  kind: 'bus' | 'durable'
  /** Durable consumerName (bus registrations carry no code-level name). */
  name?: string
}>

function eventHandlerFiles(): string[] {
  return walk(join(ROOT, 'src/contexts'))
    .filter((f) => f.includes('/infrastructure/event-handlers/'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
}

/** Bus consumers: `.on('<type>'` registrations in event-handlers modules. */
function discoverBusConsumers(): ReadonlyArray<DiscoveredConsumer> {
  const out: DiscoveredConsumer[] = []
  for (const abs of eventHandlerFiles()) {
    for (const m of read(abs).matchAll(/\.on\(\s*'([^']+)'/g)) {
      out.push({ eventType: m[1], module: rel(abs), kind: 'bus' })
    }
  }
  return out
}

/** Durable consumers: registerConsumer({ eventType, consumerName }) calls. */
function discoverDurableConsumers(): ReadonlyArray<DiscoveredConsumer> {
  const out: DiscoveredConsumer[] = []
  const files = walk(join(ROOT, 'src/contexts')).filter((f) =>
    f.endsWith('outbox-consumers.ts'),
  )
  for (const abs of files) {
    const source = read(abs)
    const matches = source.matchAll(
      /registerConsumer\(\{\s*eventType:\s*(?:'([^']+)'|([A-Z][A-Z0-9_]*)),\s*consumerName:\s*(?:'([^']+)'|([A-Z][A-Z0-9_]*))/g,
    )
    for (const m of matches) {
      const eventType = m[1] ?? resolveImportedStringConstant(abs, source, m[2] ?? '')
      const consumerName = m[3] ?? resolveImportedStringConstant(abs, source, m[4] ?? '')
      if (!eventType || !consumerName) continue
      out.push({ eventType, module: rel(abs), kind: 'durable', name: consumerName })
    }

    // A maintained literal tuple may drive one registration loop. Resolve the
    // tuple and imported consumer-name constant so the governance guard does
    // not force production code to duplicate one registerConsumer call per
    // event merely to remain mechanically discoverable.
    for (const loop of source.matchAll(
      /for\s*\(\s*const\s+(\w+)\s+of\s+(\w+)\s*\)\s*\{[\s\S]*?registerConsumer\(\{\s*eventType\s*(?::\s*(\w+))?\s*,\s*consumerName:\s*(?:'([^']+)'|(\w+))/g,
    )) {
      const [eventVariable, arrayName] = loop.slice(1, 3)
      const registeredVariable = loop[3] ?? 'eventType'
      if (eventVariable !== registeredVariable) continue

      const array = new RegExp(
        `export const ${arrayName}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\s*as const\\)`,
      ).exec(source)
      if (!array) continue

      const consumerName =
        loop[4] ?? resolveImportedStringConstant(abs, source, loop[5] ?? '')
      if (!consumerName) continue

      for (const event of array[1].matchAll(/'([^']+)'/g)) {
        out.push({
          eventType: event[1],
          module: rel(abs),
          kind: 'durable',
          name: consumerName,
        })
      }
    }
  }
  return out
}

function resolveImportedStringConstant(
  importer: string,
  source: string,
  localName: string,
): string | undefined {
  const local = new RegExp(`(?:export\\s+)?const\\s+${localName}\\s*=\\s*'([^']+)'`).exec(
    source,
  )
  if (local) return local[1]

  for (const match of source.matchAll(/import \{([^}]+)\} from '([^']+)'/g)) {
    for (const rawPart of match[1].split(',')) {
      const part = rawPart.trim().replace(/^type\s+/u, '')
      const alias = /^(\w+)\s+as\s+(\w+)$/u.exec(part)
      const exportedName = alias?.[1] ?? part
      const importedName = alias?.[2] ?? part
      if (importedName !== localName || !/^\w+$/u.test(exportedName)) continue

      const target = match[2].startsWith('#/')
        ? join(ROOT, match[2].replace(/^#\//u, 'src/'))
        : join(dirname(importer), match[2])
      const targetFile = target.endsWith('.ts') ? target : `${target}.ts`
      if (!existsSync(targetFile)) return undefined
      return new RegExp(`export const ${exportedName}\\s*=\\s*'([^']+)'`).exec(
        read(targetFile),
      )?.[1]
    }
  }
  return undefined
}

function discoverConsumers(): ReadonlyArray<DiscoveredConsumer> {
  return [...discoverBusConsumers(), ...discoverDurableConsumers()]
}

// ── 4. Job discovery (production worker composition) ───────────────

type DiscoveredJobs = Readonly<{
  /** All job names registered by production-reachable worker composition. */
  names: ReadonlyArray<string>
  /** registerCapabilityGatedJob 2nd arg: job name → capability. */
  registrationGates: ReadonlyMap<string, string>
}>

function discoverJobs(): DiscoveredJobs {
  const names = new Set<string>()
  const registrationGates = new Map<string, string>()
  for (const file of productionJobRegistrationFiles()) {
    const content = readRel(file)
    const imports = importMap(file)
    for (const m of content.matchAll(
      /registerCapabilityGatedJob\(\s*(?:'([^']+)'|([A-Z][A-Z0-9_]+)|((?:\w+\.)*\w+)\.jobName)\s*,\s*'([^']+)'/g,
    )) {
      const name = resolveJobName(m[1], m[2], undefined, imports, m[3], content)
      if (name) {
        names.add(name)
        registrationGates.set(name, m[4])
      }
    }
    for (const m of content.matchAll(
      /(?:jobRegistry|registry)\.register\(\s*(?:'([^']+)'|([A-Z][A-Z0-9_]+)|((?:\w+\.)*\w+)\.jobName)/g,
    )) {
      const name = resolveJobName(m[1], m[2], undefined, imports, m[3], content)
      if (name) names.add(name)
    }
    // Metric rollup loop: register(jobName) over JOB_NAMES.x entries.
    for (const m of content.matchAll(/JOB_NAMES\.(\w+)/g)) {
      const name = resolveJobName(undefined, undefined, m[1], imports)
      if (name) names.add(name)
    }
  }
  return { names: [...names].sort(), registrationGates }
}

const PRODUCTION_COMPOSITION_ROOTS = new Set([
  'src/bootstrap.ts',
  'src/composition.ts',
  'src/worker/index.ts',
])

function registrationCallSites(
  registrationFunction: string,
  definitionFile: string,
): ReadonlyArray<string> {
  const call = new RegExp(`\\b${registrationFunction}\\s*\\(`, 'u')
  return walk(join(ROOT, 'src'))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map(rel)
    .filter((file) => file !== definitionFile)
    .filter((file) => call.test(readRel(file)))
    .sort()
}

function isProductionCompositionFile(
  file: string,
  visited: ReadonlySet<string> = new Set(),
): boolean {
  if (PRODUCTION_COMPOSITION_ROOTS.has(file)) return true
  if (visited.has(file) || !file.endsWith('/build.ts')) return false

  const source = readRel(file)
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

function productionJobRegistrationFiles(): ReadonlyArray<string> {
  const files = new Set<string>(['src/bootstrap.ts'])
  for (const abs of walk(join(ROOT, 'src/contexts')).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
  )) {
    const file = rel(abs)
    const registrar =
      /export (?:async )?(?:const|function) (register\w*WorkerJobs)\b/u.exec(
        read(abs),
      )?.[1]
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

// ── 5. Schedule discovery (single operational authority) ───────────

/** Scheduled cadence per active job name; dark/quarantined rows are absent. */
function discoverSchedules(): ReadonlyMap<string, string> {
  const plan = createOperationalSchedulerPlan()
  return new Map(
    plan.desired.map((registration) => {
      const repeat = registration.repeat
      const schedule =
        'pattern' in repeat
          ? `cron:${repeat.pattern}`
          : `every:${repeat.every}${
              'offset' in repeat && repeat.offset !== undefined
                ? `,offset:${repeat.offset}`
                : ''
            }`
      return [registration.jobName, schedule]
    }),
  )
}

// ── Shared selectors ────────────────────────────────────────────────

const eventRow = (eventType: string): EventFamilyRow | undefined =>
  EVENT_FAMILY_ROWS.find((r) => r.eventType === eventType)
const jobRow = (jobName: string): JobFamilyRow | undefined =>
  JOB_FAMILY_ROWS.find((r) => r.jobName === jobName)
const consumerKey = (c: Pick<EventConsumerRef, 'module' | 'kind'>): string =>
  `${c.kind}:${c.module}`

const DARK_CAPS: ReadonlySet<string> = new Set<string>([
  ...Object.values(DARK_CONTEXT_CAPABILITIES),
  ...PORTAL_DARK_CAPABILITIES,
])
const BLOCKED_CAPS: ReadonlySet<string> = new Set<string>(listBlockedCapabilities())
const DARK_CONTEXT_MODULE_RE = /\/contexts\/(team|portal|guest|badge|leaderboard)\//

describe('BQC-3.1 event/job family catalogue', () => {
  it('binds every governed event family to its source Data Cell', () => {
    expect(new Set(EVENT_FAMILY_ROWS.map((row) => row.region))).toEqual(
      new Set(['source_cell']),
    )
  })

  it('binds every governed job family to the serving Data Cell', () => {
    expect(new Set(JOB_FAMILY_ROWS.map((row) => row.region))).toEqual(
      new Set(['cell_local']),
    )
  })

  it('keeps repair ownership in the observed operational authority only', () => {
    expect(
      JOB_FAMILY_ROWS.filter((row) => Object.hasOwn(row, 'repairCommand')).map(
        (row) => row.jobName,
      ),
    ).toEqual([])
  })

  it('discovers every emitted event type and catalogues it (bidirectional)', () => {
    const discovered = discoverEventTypes()

    const missing = discovered.filter((t) => !eventRow(t))
    expect(
      missing,
      `event types missing from EVENT_FAMILY_ROWS: ${missing.join(', ')}`,
    ).toEqual([])

    const stale = EVENT_FAMILY_ROWS.filter((r) => !discovered.includes(r.eventType))
    expect(
      stale.map((r) => r.eventType),
      `rows with no emitted _tag literal: ${stale.map((r) => r.eventType).join(', ')}`,
    ).toEqual([])
  })

  it('pins schemaRegistered to schema-registrations.ts', () => {
    const registered = discoverRegisteredTypes()
    const bad = EVENT_FAMILY_ROWS.filter(
      (r) => r.schemaRegistered !== registered.has(r.eventType),
    )
    expect(
      bad.map((r) => r.eventType),
      `schemaRegistered drift: ${bad.map((r) => r.eventType).join(', ')}`,
    ).toEqual([])
  })

  it('keeps producer files honest (exist + contain the type literal)', () => {
    const bad: string[] = []
    for (const r of EVENT_FAMILY_ROWS) {
      for (const f of [r.producer, ...(r.alsoProducers ?? [])]) {
        if (!existsSync(join(ROOT, f)) || !readRel(f).includes(`'${r.eventType}'`)) {
          bad.push(`${r.eventType} → ${f}`)
        }
      }
    }
    expect(bad, `dishonest producer files:\n  ${bad.join('\n  ')}`).toEqual([])
  })

  it('mirrors the actual consumer wiring exactly (bus + durable, bidirectional)', () => {
    const discovered = discoverConsumers()
    const actualByTag = new Map<string, string[]>()
    for (const d of discovered) {
      actualByTag.set(d.eventType, [
        ...(actualByTag.get(d.eventType) ?? []),
        consumerKey(d),
      ])
    }

    const drift: string[] = []
    for (const r of EVENT_FAMILY_ROWS) {
      const actual = (actualByTag.get(r.eventType) ?? []).sort()
      const declared = r.consumers.map(consumerKey).sort()
      if (actual.join('|') !== declared.join('|')) {
        drift.push(
          `${r.eventType}: declared [${declared.join(', ')}] actual [${actual.join(', ')}]`,
        )
      }
    }
    expect(drift, `consumer wiring drift:\n  ${drift.join('\n  ')}`).toEqual([])

    const stale = discovered.filter((d) => !eventRow(d.eventType))
    expect(
      stale.map((d) => `${d.eventType} ← ${d.module}`),
      `consumers of types with no family row: ${stale.map((d) => d.eventType).join(', ')}`,
    ).toEqual([])
  })

  it('pins durable consumer names to registerConsumer calls', () => {
    const bad = discoverDurableConsumers().filter((d) => {
      const ref = eventRow(d.eventType)?.consumers.find(
        (c) => c.module === d.module && c.kind === 'durable' && c.name === d.name,
      )
      return !ref
    })
    expect(
      bad.map((d) => `${d.eventType} ← ${d.name}`),
      `durable consumer name drift: ${bad.map((d) => d.name).join(', ')}`,
    ).toEqual([])
  })

  it('discovers every job registered by production worker composition (bidirectional)', () => {
    const { names } = discoverJobs()

    const missing = names.filter((n) => !jobRow(n))
    expect(missing, `jobs missing from JOB_FAMILY_ROWS: ${missing.join(', ')}`).toEqual(
      [],
    )

    const stale = JOB_FAMILY_ROWS.filter((r) => !names.includes(r.jobName))
    expect(
      stale.map((r) => r.jobName),
      `rows with no production registration: ${stale.map((r) => r.jobName).join(', ')}`,
    ).toEqual([])
  })

  it('pins the registration capability gate (registerCapabilityGatedJob 2nd arg)', () => {
    const { registrationGates } = discoverJobs()
    const bad = [...registrationGates.entries()].filter(
      ([name, cap]) => jobRow(name)?.capability !== cap,
    )
    expect(
      bad.map(([name, cap]) => `${name}: code '${cap}'`),
      `capability gate drift: ${bad.map(([n, c]) => `${n}='${c}'`).join(', ')}`,
    ).toEqual([])
  })

  it('pins schedules to the single operational scheduler plan (bidirectional)', () => {
    const discovered = discoverSchedules()

    const drift = JOB_FAMILY_ROWS.filter((r) => {
      // Non-active families remain in the managed set only so reconciliation
      // removes a previously installed recurrence. They are never part of
      // the desired runtime schedule.
      if (r.registration !== 'enabled') return discovered.has(r.jobName)
      return (discovered.get(r.jobName) ?? 'none') !== r.schedule
    })
    expect(
      drift.map(
        (r) =>
          `${r.jobName}: row '${r.schedule}' plan '${discovered.get(r.jobName) ?? 'none'}'`,
      ),
      `schedule drift:\n  ${drift.map((r) => r.jobName).join('\n  ')}`,
    ).toEqual([])

    const uncatalogued = [...discovered.keys()].filter((n) => !jobRow(n))
    expect(
      uncatalogued,
      `scheduled jobs with no family row: ${uncatalogued.join(', ')}`,
    ).toEqual([])

    const worker = readRel('src/worker/index.ts')
    expect(worker).toContain('createOperationalSchedulerPlan()')
    expect(worker).not.toMatch(/planSchedule\(\s*\{\s*jobName:/)
  })

  it('mirrors entry-point catalogue job rows (name/capability/action/processor)', () => {
    const bad = ENTRY_POINT_CATALOGUE.filter((r) => r.kind === 'job').filter((r) => {
      const j = jobRow(r.name)
      return (
        !j ||
        j.capability !== r.capability ||
        j.action !== r.action ||
        j.processor !== r.file
      )
    })
    expect(
      bad.map((r) => r.name),
      `job rows out of sync with the entry-point catalogue: ${bad.map((r) => r.name).join(', ')}`,
    ).toEqual([])
  })

  it('resolves every entry-point consumer tag to a family consumer ref', () => {
    const problems: string[] = []
    for (const r of ENTRY_POINT_CATALOGUE.filter((x) => x.kind === 'consumer')) {
      const kind = r.file.endsWith('outbox-consumers.ts') ? 'durable' : 'bus'
      for (const tag of r.eventTags ?? []) {
        const ok = eventRow(tag)?.consumers.some(
          (c) => c.module === r.file && c.kind === kind,
        )
        if (!ok) problems.push(`${r.name} → ${tag}`)
      }
    }
    expect(problems, `unresolved consumer tags:\n  ${problems.join('\n  ')}`).toEqual([])
  })

  it('maps every entry-point schedule row to a scheduled job family', () => {
    const bad = ENTRY_POINT_CATALOGUE.filter((r) => r.kind === 'schedule').filter((r) => {
      const name = /^(.*)-recurring$/.exec(r.name)?.[1]
      const j = name ? jobRow(name) : undefined
      return !j || (j.schedule === 'none' && j.registration !== 'quarantined')
    })
    expect(
      bad.map((r) => r.name),
      `schedule rows without a scheduled job family: ${bad.map((r) => r.name).join(', ')}`,
    ).toEqual([])
  })

  it('enforces the readiness invariant (enabled consumed; recorded-only durable; orphans owned; enabled jobs registered)', () => {
    const { names } = discoverJobs()

    const badEvents = EVENT_FAMILY_ROWS.filter(
      (r) =>
        (r.disposition === 'enabled' && r.consumers.length === 0) ||
        (r.disposition === 'recorded_only' &&
          (!r.recordedInOutbox || r.consumers.length > 0)) ||
        (r.disposition === 'orphan' && (r.consumers.length > 0 || !r.ownerSlice)) ||
        (r.disposition === 'quarantined' && (r.consumers.length > 0 || !r.ownerSlice)),
    )
    expect(
      badEvents.map((r) => r.eventType),
      `readiness violations: ${badEvents.map((r) => r.eventType).join(', ')}`,
    ).toEqual([])

    const badJobs = JOB_FAMILY_ROWS.filter(
      (r) => r.registration === 'enabled' && !names.includes(r.jobName),
    )
    expect(
      badJobs.map((r) => r.jobName),
      `enabled jobs not registered by production composition: ${badJobs.map((r) => r.jobName).join(', ')}`,
    ).toEqual([])
  })

  it('marks inactive legacy StaffAssignment facts as quarantined, not runtime orphans', () => {
    for (const eventType of ['staff.assigned', 'staff.unassigned']) {
      expect(eventRow(eventType)).toMatchObject({
        disposition: 'quarantined',
        consumers: [],
        ownerSlice: 'PPL-01',
      })
    }
  })

  it('keeps retained Team facts schema-only with no runtime delivery promise', () => {
    for (const eventType of ['team.created', 'team.updated', 'team.deleted']) {
      expect(eventRow(eventType)).toMatchObject({
        capability: 'team.use',
        recordedInOutbox: false,
        consumers: [],
        disposition: 'denied_dark',
        idempotencyKey: 'none',
        retention: 'none',
      })
    }
  })

  it('keeps idempotency/retention consistent with recording and consumers', () => {
    const bad = EVENT_FAMILY_ROWS.filter((r) => {
      const durableConsumed = r.consumers.some((c) => c.kind === 'durable')
      const expectedKey = durableConsumed
        ? 'eventId+consumerName'
        : r.recordedInOutbox
          ? 'eventId'
          : 'none'
      const expectedRetention = r.recordedInOutbox ? RECORDED_EVENT_RETENTION : 'none'
      return r.idempotencyKey !== expectedKey || r.retention !== expectedRetention
    })
    expect(
      bad.map((r) => r.eventType),
      `delivery-policy drift: ${bad.map((r) => r.eventType).join(', ')}`,
    ).toEqual([])
  })

  it('keeps the recorded-event catalogue horizon aligned with executable retention', () => {
    const bySubject = new Map(RETENTION_RULES.map((rule) => [rule.subject, rule]))
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1_000
    expect(RECORDED_EVENT_RETENTION).toBe('outbox:30d,receipts:30d')
    expect(bySubject.get('outbox_events.published')?.olderThanMs).toBe(thirtyDaysMs)
    expect(bySubject.get('event_consumer_receipts')?.olderThanMs).toBe(thirtyDaysMs)
  })

  it('derives event dark posture from the authoritative capability sets', () => {
    const bad = EVENT_FAMILY_ROWS.filter(
      (r) => (r.disposition === 'denied_dark') !== DARK_CAPS.has(r.capability),
    )
    expect(
      bad.map((r) => `${r.eventType} (${r.capability})`),
      `event dark-posture drift: ${bad.map((r) => r.eventType).join(', ')}`,
    ).toEqual([])
  })

  it('derives consumer-ref dark posture from the module path', () => {
    const bad = EVENT_FAMILY_ROWS.flatMap((r) =>
      r.consumers
        .filter(
          (c) =>
            (c.disposition === 'denied_dark') !== DARK_CONTEXT_MODULE_RE.test(c.module),
        )
        .map((c) => `${r.eventType} ← ${c.module}`),
    )
    expect(bad, `consumer-ref dark-posture drift:\n  ${bad.join('\n  ')}`).toEqual([])
  })

  it('keeps promotable jobs registered and blocks only permanent prohibitions', () => {
    const quarantinedJobs = new Set([
      'expire-review-provider-source',
      'purge-expired-reviews',
      'advance-organization-lifecycle',
      'generate-organization-export',
      'purge-expired-organization-exports',
    ])
    const bad = JOB_FAMILY_ROWS.filter((r) => {
      const expected = BLOCKED_CAPS.has(r.capability)
        ? 'blocked_capability'
        : quarantinedJobs.has(r.jobName)
          ? 'quarantined'
          : 'enabled'
      return r.registration !== expected
    })
    expect(
      bad.map((r) => `${r.jobName} (${r.capability})`),
      `job registration-posture drift: ${bad.map((r) => r.jobName).join(', ')}`,
    ).toEqual([])
  })

  it('declares an explicit retry policy (attempts/backoff/timeout) per job family (BQC-3.6)', () => {
    const bad = JOB_FAMILY_ROWS.filter(
      (r) =>
        !Number.isInteger(r.retryAttempts) ||
        r.retryAttempts < 1 ||
        !/^(exponential|fixed):\d+$/.test(r.retryBackoff) ||
        !Number.isInteger(r.timeoutMs) ||
        r.timeoutMs < 1_000,
    )
    expect(
      bad.map((r) => r.jobName),
      `job families without a well-formed explicit retry policy: ${bad.map((r) => r.jobName).join(', ')}`,
    ).toEqual([])
  })

  it('keeps publication reconciliation inside its non-cancelling worker timeout', () => {
    const row = JOB_FAMILY_ROWS.find(
      (candidate) => candidate.jobName === 'reconcile-ambiguous-publications',
    )
    expect(row).toBeDefined()
    const source = readRel(
      'src/contexts/review/infrastructure/jobs/reconcile-ambiguous-publications.job.ts',
    )
    const deadline = /RECONCILIATION_MAX_RUN_MS\s*=\s*([\d_]+)/.exec(source)?.[1]
    expect(deadline).toBeDefined()
    const internalDeadlineMs = Number(deadline!.replaceAll('_', ''))

    expect(row!.timeoutMs - internalDeadlineMs).toBeGreaterThanOrEqual(60_000)
    expect(row!.notes).toContain('PostgreSQL session advisory lease')
    expect(row!.notes).toContain('unstarted suffix remains due')
  })

  it('has unique names, existing referenced files, and version ≥ 1', () => {
    const tags = EVENT_FAMILY_ROWS.map((r) => r.eventType)
    const dupeTags = tags.filter((t, i) => tags.indexOf(t) !== i)
    expect(dupeTags, `duplicate eventTypes: ${dupeTags.join(', ')}`).toEqual([])

    const names = JOB_FAMILY_ROWS.map((r) => r.jobName)
    const dupeNames = names.filter((n, i) => names.indexOf(n) !== i)
    expect(dupeNames, `duplicate jobNames: ${dupeNames.join(', ')}`).toEqual([])

    const files = new Set<string>()
    for (const r of EVENT_FAMILY_ROWS) {
      files.add(r.producer)
      for (const c of r.consumers) files.add(c.module)
    }
    for (const r of JOB_FAMILY_ROWS) files.add(r.processor)
    const missing = [...files].filter((f) => !existsSync(join(ROOT, f)))
    expect(missing, `referenced files that do not exist: ${missing.join(', ')}`).toEqual(
      [],
    )

    const badVersion = EVENT_FAMILY_ROWS.filter((r) => r.version < 1)
    expect(
      badVersion.map((r) => r.eventType),
      `version must be ≥ 1: ${badVersion.map((r) => r.eventType).join(', ')}`,
    ).toEqual([])
  })
})
