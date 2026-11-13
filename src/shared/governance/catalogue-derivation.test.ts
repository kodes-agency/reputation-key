// The job, consumer and entry-point catalogues are derived from the definitions
// in src/shared/jobs/job-definitions.ts and src/shared/events/consumer-definitions.ts.
// catalogue-pinned.json holds every row as it was written by hand before the
// derivation; these tests compare the derived rows with it field by field, so a
// definition edit that moves a queue, retry, cadence, scope, gate or consumer is
// a deliberate change to both.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DURABLE_CONSUMERS } from '#/shared/events/consumer-definitions'
import { CONSUMER_ENTRY_POINTS } from '#/shared/events/consumer-entry-points'
import { JOB_DEFINITIONS } from '#/shared/jobs/job-definitions'
import { ENTRY_POINT_CATALOGUE } from './entry-point-catalogue'
import { EVENT_FAMILY_ROWS, JOB_FAMILY_ROWS } from './event-job-catalogue'

type Pinned = Readonly<{
  events: ReadonlyArray<{
    eventType: string
    consumers: ReadonlyArray<{ name: string; module: string }>
  }>
  jobs: ReadonlyArray<Record<string, unknown>>
  entryPoints: ReadonlyArray<Record<string, unknown>>
}>

const pinned: Pinned = JSON.parse(
  readFileSync(new URL('./catalogue-pinned.json', import.meta.url), 'utf8'),
)

const byKey = <T>(rows: ReadonlyArray<T>, key: (row: T) => string): Map<string, T> =>
  new Map(rows.map((row) => [key(row), row]))

describe('derived job families', () => {
  it('keep every pinned field of every job, in the pinned order', () => {
    expect(JOB_FAMILY_ROWS).toEqual(pinned.jobs)
  })

  it('declare each job once', () => {
    const names = JOB_DEFINITIONS.map((def) => def.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('derived event families', () => {
  it('keep every event type, in the pinned order', () => {
    expect(EVENT_FAMILY_ROWS.map((row) => row.eventType)).toEqual(
      pinned.events.map((row) => row.eventType),
    )
  })

  it('give each event the same consumers, by name and registering module', () => {
    const derived = byKey(EVENT_FAMILY_ROWS, (row) => row.eventType)
    for (const row of pinned.events) {
      const sorted = (consumers: ReadonlyArray<{ name: string; module: string }>) =>
        [...consumers].sort((a, b) => a.name.localeCompare(b.name))
      expect(sorted(derived.get(row.eventType)?.consumers ?? [])).toEqual(
        sorted(row.consumers),
      )
    }
  })

  it('only names events the outbox routes', () => {
    const events = new Set(EVENT_FAMILY_ROWS.map((row) => row.eventType))
    for (const consumer of DURABLE_CONSUMERS) {
      for (const eventType of consumer.on) expect(events.has(eventType)).toBe(true)
    }
  })
})

describe('derived entry points', () => {
  it('keep every pinned row of every kind field by field', () => {
    const key = (row: { kind?: unknown; name?: unknown }) => `${row.kind}:${row.name}`
    const derived = byKey(ENTRY_POINT_CATALOGUE, (row) => key(row))
    expect(derived.size).toBe(ENTRY_POINT_CATALOGUE.length)
    expect(ENTRY_POINT_CATALOGUE).toHaveLength(pinned.entryPoints.length)
    for (const row of pinned.entryPoints) {
      expect(derived.get(key(row))).toEqual(row)
    }
  })
})

describe('definitions stay below the catalogues', () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url))
  const importPattern = /(?:from|import)\s+'((?:#\/|\.\.?\/)[^']+)'/g

  const resolveImport = (from: string, spec: string): string | undefined => {
    const base = spec.startsWith('#/')
      ? join(root, 'src', spec.slice(2))
      : join(dirname(from), spec)
    return [`${base}.ts`, join(base, 'index.ts')].find((path) => existsSync(path))
  }

  const reachable = (entry: string): ReadonlySet<string> => {
    const seen = new Set<string>()
    const pending = [entry]
    for (let file = pending.pop(); file; file = pending.pop()) {
      if (seen.has(file)) continue
      seen.add(file)
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(importPattern)) {
        const target = resolveImport(file, match[1] ?? '')
        if (target) pending.push(target)
      }
    }
    return seen
  }

  it.each([
    'src/shared/jobs/job-definitions.ts',
    'src/shared/events/consumer-definitions.ts',
    'src/shared/events/consumer-entry-points.ts',
  ])('%s reaches nothing in src/shared/governance', (entry) => {
    const governance = join(root, 'src/shared/governance')
    const reached = [...reachable(join(root, entry))].filter((file) =>
      file.startsWith(governance),
    )
    expect(reached).toEqual([])
  })

  const sourceFiles = (dir: string): ReadonlyArray<string> =>
    readdirSync(join(root, dir))
      .filter((name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name))
      .map((name) => join(root, dir, name))

  const directImports = (file: string): ReadonlyArray<string> =>
    [...readFileSync(file, 'utf8').matchAll(importPattern)]
      .map((match) => resolveImport(file, match[1] ?? ''))
      .filter((target): target is string => target !== undefined)

  it.each(['src/shared/jobs', 'src/shared/events'])(
    'no module in %s imports src/shared/governance',
    (dir) => {
      const governance = join(root, 'src/shared/governance')
      const importing = sourceFiles(dir).filter((file) =>
        directImports(file).some((target) => target.startsWith(governance)),
      )
      expect(importing).toEqual([])
    },
  )

  it('governance reads only the definition modules of src/shared/jobs and src/shared/events', () => {
    const allowed = new Set(
      [
        'src/shared/jobs/job-definitions.ts',
        'src/shared/events/consumer-definitions.ts',
        'src/shared/events/consumer-entry-points.ts',
      ].map((path) => join(root, path)),
    )
    const outside = sourceFiles('src/shared/governance').flatMap((file) =>
      directImports(file).filter(
        (target) =>
          (target.startsWith(join(root, 'src/shared/jobs')) ||
            target.startsWith(join(root, 'src/shared/events'))) &&
          !allowed.has(target),
      ),
    )
    expect(outside).toEqual([])
  })
})

describe('durable consumers name their entry-point row', () => {
  const entryPointNames = new Set(CONSUMER_ENTRY_POINTS.map((row) => row.name))

  it('points every durable consumer at a consumer row', () => {
    for (const consumer of DURABLE_CONSUMERS) {
      expect(entryPointNames.has(consumer.entryPoint), consumer.name).toBe(true)
    }
  })

  it('leaves no consumer row without a durable consumer', () => {
    const used = new Set(DURABLE_CONSUMERS.map((consumer) => consumer.entryPoint))
    for (const row of CONSUMER_ENTRY_POINTS)
      expect(used.has(row.name), row.name).toBe(true)
  })

  it('matches the module each registration site authorizes it under', () => {
    const root = fileURLToPath(new URL('../../..', import.meta.url))
    const registrations = new Map<string, string>()
    for (const consumer of DURABLE_CONSUMERS) {
      const source = readFileSync(join(root, consumer.module), 'utf8')
      const literal = new RegExp(
        `consumerName:\\s*'${consumer.name.replace(/\./g, '\\.')}',\\s*module:\\s*'([^']+)'`,
      )
      const found = literal.exec(source)?.[1]
      if (found) registrations.set(consumer.name, found)
    }
    expect(registrations.size).toBeGreaterThan(0)
    for (const consumer of DURABLE_CONSUMERS) {
      const found = registrations.get(consumer.name)
      if (found) expect(consumer.entryPoint, consumer.name).toBe(found)
    }
  })
})
