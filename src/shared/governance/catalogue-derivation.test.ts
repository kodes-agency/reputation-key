// The job, consumer and entry-point catalogues are derived from the definitions
// in src/shared/jobs/job-definitions.ts and src/shared/events/consumer-definitions.ts.
// The definitions are the only place a row is written; these tests check that the
// derivation keeps every definition and that each one is complete.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createContainer } from '#/composition'
import { DURABLE_CONSUMERS } from '#/shared/events/consumer-definitions'
import { CONSUMER_ENTRY_POINTS } from '#/shared/events/consumer-entry-points'
import { JOB_DEFINITIONS } from '#/shared/jobs/job-definitions'
import type { Database } from '#/shared/db'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createInMemoryQueue } from '#/shared/testing/in-memory-queue'
import { ENTRY_POINT_CATALOGUE } from './entry-point-catalogue'
import { EVENT_FAMILY_ROWS, JOB_FAMILY_ROWS } from './event-job-catalogue'

const SCHEDULE_DECISION = /^(none|every:\d+(,offset:\d+)?|cron:\S.*)$/

const duplicates = (names: ReadonlyArray<string>): ReadonlyArray<string> =>
  names.filter((name, index) => names.indexOf(name) !== index)

describe('derived job families', () => {
  it('declare each job once', () => {
    expect(duplicates(JOB_DEFINITIONS.map((def) => def.name))).toEqual([])
  })

  it('keep every definition, in order', () => {
    expect(JOB_FAMILY_ROWS.map((row) => row.jobName)).toEqual(
      JOB_DEFINITIONS.map((def) => def.name),
    )
  })

  it('give every job a schedule decision', () => {
    const undecided = JOB_FAMILY_ROWS.filter(
      (row) => !SCHEDULE_DECISION.test(row.schedule),
    ).map((row) => row.jobName)
    expect(undecided).toEqual([])
  })
})

describe('derived event families', () => {
  it('list each event type once', () => {
    expect(duplicates(EVENT_FAMILY_ROWS.map((row) => row.eventType))).toEqual([])
  })

  it('give each event exactly the consumers that receive it', () => {
    for (const row of EVENT_FAMILY_ROWS) {
      const expected = DURABLE_CONSUMERS.filter((c) => c.on.includes(row.eventType))
        .map((c) => c.name)
        .sort()
      expect(row.consumers.map((c) => c.name).sort(), row.eventType).toEqual(expected)
    }
  })

  it('declare each consumer once', () => {
    expect(duplicates(DURABLE_CONSUMERS.map((c) => c.name))).toEqual([])
  })

  it('only names events the outbox routes', () => {
    const events = new Set(EVENT_FAMILY_ROWS.map((row) => row.eventType))
    for (const consumer of DURABLE_CONSUMERS) {
      for (const eventType of consumer.on) expect(events.has(eventType)).toBe(true)
    }
  })
})

describe('derived entry points', () => {
  const key = (row: { kind: string; name: string }) => `${row.kind}:${row.name}`

  it('hold each kind and name once', () => {
    expect(duplicates(ENTRY_POINT_CATALOGUE.map(key))).toEqual([])
  })

  it('give every job a job row and every scheduled job a schedule row', () => {
    const keys = new Set(ENTRY_POINT_CATALOGUE.map(key))
    const missing = JOB_DEFINITIONS.flatMap((def) => [
      ...(keys.has(`job:${def.name}`) ? [] : [`job:${def.name}`]),
      ...(def.schedule === 'none' || keys.has(`schedule:${def.name}-recurring`)
        ? []
        : [`schedule:${def.name}-recurring`]),
    ])
    expect(missing).toEqual([])
  })

  it('carry every consumer row', () => {
    const keys = new Set(ENTRY_POINT_CATALOGUE.map(key))
    expect(CONSUMER_ENTRY_POINTS.filter((row) => !keys.has(key(row))).map(key)).toEqual(
      [],
    )
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

  it('matches the module each registration site authorizes it under', async () => {
    const container = createContainer({
      clock: () => new Date('2026-01-15T12:00:00.000Z'),
      queue: createInMemoryQueue({ clock: () => new Date('2026-01-15T12:00:00.000Z') }),
      backgroundQueue: createInMemoryQueue({
        clock: () => new Date('2026-01-15T12:00:00.000Z'),
      }),
      opsDomainEventsQueue: createInMemoryQueue({
        clock: () => new Date('2026-01-15T12:00:00.000Z'),
      }),
      opsQuarantineQueue: createInMemoryQueue({
        clock: () => new Date('2026-01-15T12:00:00.000Z'),
      }),
      redis: undefined,
      enableJobs: true,
      db: new Proxy(
        {},
        {
          get: () => {
            throw new Error('composition must not query the DB during construction')
          },
        },
      ) as unknown as Database,
      identityPort: createInMemoryIdentityPort(),
      email: async () => {},
    })
    container.registerOutboxConsumers()

    const unregistered: string[] = []
    const wrongModule: string[] = []
    for (const consumer of DURABLE_CONSUMERS) {
      const registered = consumer.on
        .flatMap((eventType) => container.consumerRegistry.listFor(eventType))
        .filter((registration) => registration.consumerName === consumer.name)
      if (registered.length === 0) unregistered.push(consumer.name)
      for (const registration of registered) {
        if (registration.module !== consumer.entryPoint) wrongModule.push(consumer.name)
      }
    }
    await container.shutdown.run()

    expect({ unregistered, wrongModule }).toEqual({ unregistered: [], wrongModule: [] })
  })
})
