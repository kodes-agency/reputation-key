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
//   5. jobs — bootstrap.ts register(...) / registerCapabilityGatedJob(...)
//      with imported JOB_NAME(S) constant resolution (same approach as the
//      BQC-2.1 entry-point catalogue guard)
//   6. schedules — worker/index.ts backgroundQueue.add(...) repeat options
//   7. cross-catalogue consistency with the BQC-2.1 entry-point catalogue
//
// Policy invariants: enabled event families have consumers, orphan families
// are owned by a later slice, enabled jobs are actually registered, and
// dark/blocked posture is derived from the authoritative capability sets —
// never hand-declared.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  EVENT_FAMILY_ROWS,
  JOB_FAMILY_ROWS,
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

const ROOT = process.cwd()
const rel = (abs: string): string => relative(ROOT, abs)

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const read = (abs: string): string => readFileSync(abs, 'utf8')
const readRel = (file: string): string => read(join(ROOT, file))

// ── Constant resolution (same approach as BQC-2.1) ──────────────────

type ImportTarget = Readonly<{ constName: string; sourceFile: string }>

/** Import map for a file: local identifier → { constName, sourceFile }. */
function importMap(file: string): Map<string, ImportTarget> {
  const content = readRel(file)
  const map = new Map<string, ImportTarget>()
  const add = (names: string, source: string) => {
    const sourceFile =
      source.replace(/^#\//, 'src/') + (source.endsWith('.ts') ? '' : '.ts')
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
): string | undefined {
  if (literal) return literal
  if (recordKey) {
    const target = imports.get('JOB_NAMES')
    return target
      ? resolveRecordConstant(target.constName, recordKey, target.sourceFile)
      : undefined
  }
  if (!ident) return undefined
  const target = imports.get(ident)
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
    const matches = read(abs).matchAll(
      /registerConsumer\(\{\s*eventType:\s*'([^']+)',\s*consumerName:\s*'([^']+)'/g,
    )
    for (const m of matches) {
      out.push({ eventType: m[1], module: rel(abs), kind: 'durable', name: m[2] })
    }
  }
  return out
}

function discoverConsumers(): ReadonlyArray<DiscoveredConsumer> {
  return [...discoverBusConsumers(), ...discoverDurableConsumers()]
}

// ── 4. Job discovery (bootstrap.ts) ─────────────────────────────────

type DiscoveredJobs = Readonly<{
  /** All job names registered in bootstrap.ts. */
  names: ReadonlyArray<string>
  /** registerCapabilityGatedJob 2nd arg: job name → capability. */
  registrationGates: ReadonlyMap<string, string>
}>

function discoverJobs(): DiscoveredJobs {
  const file = 'src/bootstrap.ts'
  const content = readRel(file)
  const imports = importMap(file)
  const names = new Set<string>()
  const registrationGates = new Map<string, string>()
  for (const m of content.matchAll(
    /registerCapabilityGatedJob\(\s*(?:'([^']+)'|(\w+))\s*,\s*'([^']+)'/g,
  )) {
    const name = resolveJobName(m[1], m[2], undefined, imports)
    if (name) {
      names.add(name)
      registrationGates.set(name, m[3])
    }
  }
  for (const m of content.matchAll(/jobRegistry\.register\(\s*(?:'([^']+)'|(\w+))/g)) {
    const name = resolveJobName(m[1], m[2], undefined, imports)
    if (name) names.add(name)
  }
  // Metric rollup loop: register(jobName) over JOB_NAMES.x entries.
  for (const m of content.matchAll(/JOB_NAMES\.(\w+)/g)) {
    const name = resolveJobName(undefined, undefined, m[1], imports)
    if (name) names.add(name)
  }
  return { names: [...names].sort(), registrationGates }
}

// ── 5. Schedule discovery (worker/index.ts) ─────────────────────────

/** Evaluate a pure numeric multiply expression ('5 * 60 * 1000' → 300000). */
function evalNumericExpr(expr: string): number {
  return expr
    .split('*')
    .map((p) => Number(p.trim()))
    .reduce((a, b) => a * b, 1)
}

/** Canonical schedule string: 'cron:<pattern>' | 'every:<ms>[,offset:<ms>]' | 'none'. */
function scheduleString(pattern?: string, every?: string, offset?: string): string {
  if (pattern) return `cron:${pattern}`
  if (!every) return 'none'
  const ms = evalNumericExpr(every)
  return offset ? `every:${ms},offset:${evalNumericExpr(offset)}` : `every:${ms}`
}

/** Standalone `.add(NAME, {}, { repeat, jobId: '<name>-recurring' })` calls. */
function standaloneSchedules(content: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const chunk of content.split('.add(').slice(1)) {
    // Repeat options are read only up to the jobId literal — the chunk runs
    // on until the next `.add(` and would otherwise absorb unrelated
    // `pattern:`/`every:` keys from later schedule tables.
    const jobId = /jobId:\s*'([^']+)-recurring'/.exec(chunk)
    if (!jobId) continue
    const opts = chunk.slice(0, jobId.index)
    const every = /every:\s*([0-9]+(?:\s*\*\s*[0-9]+)*)/.exec(opts)?.[1]
    const offset = /offset:\s*([0-9]+(?:\s*\*\s*[0-9]+)*)/.exec(opts)?.[1]
    const pattern = /pattern:\s*'([^']+)'/.exec(opts)?.[1]
    out.set(jobId[1], scheduleString(pattern, every, offset))
  }
  return out
}

/** Entries of the metricSchedules / capabilitySchedules array literals. */
function arrayLiteralSchedules(
  content: string,
  imports: Map<string, ImportTarget>,
): Map<string, string> {
  const out = new Map<string, string>()
  const entryRe =
    /jobName:\s*(?:'([^']+)'|JOB_NAMES\.(\w+)|(\w+)),\s*(?:pattern:\s*'([^']+)'|every:\s*([0-9]+(?:\s*\*\s*[0-9]+)*))/g
  for (const m of content.matchAll(entryRe)) {
    const name = resolveJobName(m[1], m[3], m[2], imports)
    if (name) out.set(name, scheduleString(m[4], m[5], undefined))
  }
  return out
}

/** Scheduled cadence per job name ('none' when the job is never scheduled). */
function discoverSchedules(): ReadonlyMap<string, string> {
  const file = 'src/worker/index.ts'
  const content = readRel(file)
  const imports = importMap(file)
  return new Map([
    ...standaloneSchedules(content),
    ...arrayLiteralSchedules(content, imports),
  ])
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
const DARK_CONTEXT_MODULE_RE = /\/contexts\/(team|portal|guest|goal|badge|leaderboard)\//

describe('BQC-3.1 event/job family catalogue', () => {
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
        (c) => c.module === d.module && c.kind === 'durable',
      )
      return !ref || ref.name !== d.name
    })
    expect(
      bad.map((d) => `${d.eventType} ← ${d.name}`),
      `durable consumer name drift: ${bad.map((d) => d.name).join(', ')}`,
    ).toEqual([])
  })

  it('discovers every job registered in bootstrap.ts (bidirectional)', () => {
    const { names } = discoverJobs()

    const missing = names.filter((n) => !jobRow(n))
    expect(missing, `jobs missing from JOB_FAMILY_ROWS: ${missing.join(', ')}`).toEqual(
      [],
    )

    const stale = JOB_FAMILY_ROWS.filter((r) => !names.includes(r.jobName))
    expect(
      stale.map((r) => r.jobName),
      `rows with no bootstrap registration: ${stale.map((r) => r.jobName).join(', ')}`,
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

  it('pins schedules to worker/index.ts (bidirectional)', () => {
    const discovered = discoverSchedules()

    const drift = JOB_FAMILY_ROWS.filter(
      (r) => (discovered.get(r.jobName) ?? 'none') !== r.schedule,
    )
    expect(
      drift.map(
        (r) =>
          `${r.jobName}: row '${r.schedule}' worker '${discovered.get(r.jobName) ?? 'none'}'`,
      ),
      `schedule drift:\n  ${drift.map((r) => r.jobName).join('\n  ')}`,
    ).toEqual([])

    const uncatalogued = [...discovered.keys()].filter((n) => !jobRow(n))
    expect(
      uncatalogued,
      `scheduled jobs with no family row: ${uncatalogued.join(', ')}`,
    ).toEqual([])
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
      return !j || j.schedule === 'none'
    })
    expect(
      bad.map((r) => r.name),
      `schedule rows without a scheduled job family: ${bad.map((r) => r.name).join(', ')}`,
    ).toEqual([])
  })

  it('enforces the readiness invariant (enabled consumed; orphans owned; enabled jobs registered)', () => {
    const { names } = discoverJobs()

    const badEvents = EVENT_FAMILY_ROWS.filter(
      (r) =>
        (r.disposition === 'enabled' && r.consumers.length === 0) ||
        (r.disposition === 'orphan' && (r.consumers.length > 0 || !r.ownerSlice)),
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
      `enabled jobs not registered in bootstrap.ts: ${badJobs.map((r) => r.jobName).join(', ')}`,
    ).toEqual([])
  })

  it('keeps idempotency/retention consistent with recording and consumers', () => {
    const bad = EVENT_FAMILY_ROWS.filter((r) => {
      const durableConsumed = r.consumers.some((c) => c.kind === 'durable')
      const expectedKey = durableConsumed
        ? 'eventId+consumerName'
        : r.recordedInOutbox
          ? 'eventId'
          : 'none'
      const expectedRetention = r.recordedInOutbox ? 'outbox:7d,receipts:90d' : 'none'
      return r.idempotencyKey !== expectedKey || r.retention !== expectedRetention
    })
    expect(
      bad.map((r) => r.eventType),
      `delivery-policy drift: ${bad.map((r) => r.eventType).join(', ')}`,
    ).toEqual([])
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

  it('derives job registration posture from the authoritative capability sets', () => {
    const bad = JOB_FAMILY_ROWS.filter((r) => {
      const expected = BLOCKED_CAPS.has(r.capability)
        ? 'blocked_capability'
        : DARK_CAPS.has(r.capability)
          ? 'denied_dark'
          : 'enabled'
      return r.registration !== expected
    })
    expect(
      bad.map((r) => `${r.jobName} (${r.capability})`),
      `job registration-posture drift: ${bad.map((r) => r.jobName).join(', ')}`,
    ).toEqual([])
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
