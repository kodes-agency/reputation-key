// Static guards on what the event/job catalogue promises (wiring-09, wiring-04).
//
// Readiness proves every catalogued consumer and enabled job has a registered
// handler. Nothing proved the other end: that production code still emits the
// fact a consumer waits for, or enqueues a job no scheduler fires. These guards
// scan production source for it, and make a row without a producer say why.

import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walk } from '#/shared/testing/source-tree'
import { PRODUCERLESS_EVENT_FAMILIES } from './producerless-event-families'
import {
  EVENT_FAMILY_ROWS,
  JOB_FAMILY_ROWS,
  type EventFamilyRow,
  type JobFamilyRow,
} from './event-job-catalogue'

const ROOT = process.cwd()

type SourceFile = Readonly<{ path: string; text: string }>

/** Tests, stories and test support never count as producers. */
const isProductionSource = (path: string): boolean =>
  /\.tsx?$/.test(path) &&
  !/\.(?:test|stories)\.tsx?$/.test(path) &&
  !path.startsWith('src/shared/testing/') &&
  !path.startsWith('src/shared/db/testing/')

/** Production TypeScript under src/, by repo-relative path. */
const SOURCES: ReadonlyArray<SourceFile> = walk(join(ROOT, 'src'))
  .map((file) => relative(ROOT, file))
  .filter(isProductionSource)
  .map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }))

const SOURCE_BY_PATH: ReadonlyMap<string, SourceFile> = new Map(
  SOURCES.map((file) => [file.path, file]),
)

/** The string literal a `const` declared in `text` holds. */
const declaredString = (text: string, name: string): string | undefined =>
  new RegExp(`\\bconst\\s+${name}\\s*=\\s*'([^']+)'`).exec(text)?.[1]

/** The production module an import specifier names. */
function importedSource(from: string, specifier: string): SourceFile | undefined {
  const base = specifier.startsWith('#/')
    ? join('src', specifier.slice(2))
    : join(dirname(from), specifier)
  return (
    SOURCE_BY_PATH.get(base) ??
    SOURCE_BY_PATH.get(`${base}.ts`) ??
    SOURCE_BY_PATH.get(join(base, 'index.ts'))
  )
}

/**
 * The string an identifier holds in `file`: a local `const`, or a `const`
 * declared by the module it is named-imported from (aliases followed, one hop).
 */
function constantValue(file: SourceFile, name: string): string | undefined {
  const local = declaredString(file.text, name)
  if (local !== undefined) return local
  const imports = file.text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)
  for (const [, names = '', specifier = ''] of imports) {
    for (const entry of names.split(',')) {
      const [original = '', alias = original] = entry.trim().split(/\s+as\s+/)
      if (alias !== name) continue
      const target = importedSource(file.path, specifier)
      return target === undefined ? undefined : declaredString(target.text, original)
    }
  }
  return undefined
}

// ── Event families ──────────────────────────────────────────────────

/** Domain event modules (`events.ts`, and Reporting's `metric-`/`goal-events.ts`). */
const EVENT_MODULE = /^src\/contexts\/[^/]+\/domain\/(?:[\w-]+-)?events\.ts$/

type EventConstructor = Readonly<{ name: string; tag: string; module: string }>

/** Every exported `const` in an event module whose body builds a `_tag` literal. */
const EVENT_CONSTRUCTORS: ReadonlyArray<EventConstructor> = SOURCES.filter((file) =>
  EVENT_MODULE.test(file.path),
).flatMap((file) =>
  file.text.split(/\n(?=export )/).flatMap((declaration) => {
    const name = /^export const (\w+) =/.exec(declaration)?.[1]
    const tag = /_tag:\s*'([^']+)',/.exec(declaration)?.[1]
    return name === undefined || tag === undefined
      ? []
      : [{ name, tag, module: file.path }]
  }),
)

/** Whether `file` builds a `_tag` object literal (string or constant) for `tag`. */
const buildsTag = (file: SourceFile, tag: string): boolean =>
  [
    ...file.text.matchAll(
      /_tag:\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*(?:as const\s*)?,/g,
    ),
  ].some(([, literal, name]) => (literal ?? constantValue(file, name ?? '')) === tag)

/**
 * Production files that emit the family's fact: a call to one of its
 * constructors outside the event module, or a `_tag` literal built outside the
 * event modules and the family's own consumers (which rebuild delivered facts).
 */
function producersOf(row: EventFamilyRow): ReadonlyArray<string> {
  const consumerModules = new Set(row.consumers.map((consumer) => consumer.module))
  const callers = EVENT_CONSTRUCTORS.filter(
    (constructor) => constructor.tag === row.eventType,
  ).flatMap((constructor) =>
    SOURCES.filter(
      (file) =>
        file.path !== constructor.module &&
        new RegExp(`\\b${constructor.name}\\(`).test(file.text),
    ).map((file) => file.path),
  )
  const builders = SOURCES.filter(
    (file) =>
      !EVENT_MODULE.test(file.path) &&
      !consumerModules.has(file.path) &&
      buildsTag(file, row.eventType),
  ).map((file) => file.path)
  return [...new Set([...callers, ...builders])]
}

describe('event families with durable consumers', () => {
  const consumed = EVENT_FAMILY_ROWS.filter((row) => row.consumers.length > 0)

  it('finds the constructors it scans for', () => {
    expect(EVENT_CONSTRUCTORS.map((constructor) => constructor.name)).toEqual(
      expect.arrayContaining(['reviewCreated', 'guestQualifiedScanRecorded']),
    )
  })

  it('are emitted by production code unless the catalogue says why not', () => {
    const unexplained = consumed
      .filter(
        (row) =>
          PRODUCERLESS_EVENT_FAMILIES[row.eventType] === undefined &&
          producersOf(row).length === 0,
      )
      .map((row) => row.eventType)

    expect(
      unexplained,
      'emit these facts, or list them with a reason in producerless-event-families.ts',
    ).toEqual([])
  })

  it('keep a producerless entry only for a consumed family nothing emits', () => {
    const stale = Object.keys(PRODUCERLESS_EVENT_FAMILIES)
      .map((eventType) => {
        const row = EVENT_FAMILY_ROWS.find(
          (candidate) => candidate.eventType === eventType,
        )
        return {
          eventType,
          consumed: (row?.consumers.length ?? 0) > 0,
          producers: row ? producersOf(row) : [],
        }
      })
      .filter((entry) => !entry.consumed || entry.producers.length > 0)

    expect(stale, 'drop these entries from producerless-event-families.ts').toEqual([])
  })
})

// ── Job families ────────────────────────────────────────────────────

/** Job names a file enqueues: `.add(<name>, …)` calls and bulk `{ name: <name> }` entries. */
const enqueuedJobs = (file: SourceFile): ReadonlySet<string> =>
  new Set(
    [...file.text.matchAll(/(?:\.add\(|\bname:)\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*,/g)]
      .map(([, literal, name]) => literal ?? constantValue(file, name ?? ''))
      .filter((jobName): jobName is string => jobName !== undefined),
  )

const ENQUEUES: ReadonlyArray<Readonly<{ path: string; jobs: ReadonlySet<string> }>> =
  SOURCES.map((file) => ({ path: file.path, jobs: enqueuedJobs(file) }))

/** Files other than the family's own processor that enqueue it by name. */
const jobProducersOf = (row: JobFamilyRow): ReadonlyArray<string> =>
  ENQUEUES.filter(
    (file) => file.path !== row.processor && file.jobs.has(row.jobName),
  ).map((file) => file.path)

/**
 * Enabled on-demand families the enqueue scan cannot see, each naming the
 * module that says where its jobs come from and text that must appear there.
 */
const UNSCANNED_JOB_PRODUCERS: Readonly<
  Record<string, Readonly<{ module: string; evidence: string }>>
> = {
  // enqueueImmediateEmail chooses the job name per email.
  'urgent-email': {
    module: 'src/contexts/feed/build.ts',
    evidence: 'immediateEmailDispatch(data.propertyId)',
  },
  'mandatory-email': {
    module: 'src/contexts/feed/build.ts',
    evidence: 'immediateEmailDispatch(data.propertyId)',
  },
  // Rolling drain only: nothing enqueues either name any more, and the job
  // module says when both handlers can go.
  'project-recent-activity': {
    module: 'src/contexts/feed/infrastructure/jobs/project-recent-activity.job.ts',
    evidence: 'drain-only BullMQ handlers',
  },
  'insert-activity-log': {
    module: 'src/contexts/feed/infrastructure/jobs/project-recent-activity.job.ts',
    evidence: 'Rolling-deployment drain identifier only',
  },
}

describe('enabled job families without a schedule', () => {
  const onDemand = JOB_FAMILY_ROWS.filter(
    (row) => row.registration === 'enabled' && row.schedule === 'none',
  )

  it('are enqueued outside their own processor, or listed with their producer', () => {
    const unproduced = onDemand
      .filter(
        (row) =>
          jobProducersOf(row).length === 0 && !(row.jobName in UNSCANNED_JOB_PRODUCERS),
      )
      .map((row) => row.jobName)

    expect(
      unproduced,
      'enqueue these jobs, schedule them, quarantine them, or name their producer',
    ).toEqual([])
  })

  it('list only rows the scan cannot see, with evidence where they point', () => {
    const invalid = Object.entries(UNSCANNED_JOB_PRODUCERS)
      .map(([jobName, { module, evidence }]) => {
        const row = onDemand.find((candidate) => candidate.jobName === jobName)
        return {
          jobName,
          onDemand: row !== undefined,
          scanned: row === undefined ? [] : jobProducersOf(row),
          evidenced: SOURCE_BY_PATH.get(module)?.text.includes(evidence) ?? false,
        }
      })
      .filter((entry) => !entry.onDemand || entry.scanned.length > 0 || !entry.evidenced)

    expect(invalid, 'drop or correct these UNSCANNED_JOB_PRODUCERS entries').toEqual([])
  })
})
