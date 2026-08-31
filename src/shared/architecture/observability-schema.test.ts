// BQC-7.3 — observability schema gate.
//
// Four pins, all derived from the executable policy in
// observability/metrics-schema.ts:
//
//   (a) SNAPSHOT REGISTRATION — every leaf field path of a REAL assembled
//       OperationsSnapshot resolves to a registered metric definition (or an
//       explicit non-metric allowlist entry below: timestamps, static queue
//       names, the degraded marker list). New snapshot fields fail until
//       registered — the schema and the snapshot cannot drift apart.
//   (b) LOG-FIELD SCAN — no logger call-site object (any argument position,
//       any nesting depth) contains a BANNED_LOG_KEY. This is the canary
//       sweep gate: it went RED listing the pre-slice call-sites and must go
//       GREEN by REMOVAL, never by weakening the banlist.
//   (c) SPAN ATTRS — the pino mixin merges SpanAttrs into every log line, so
//       the interface itself must not declare a banned key.
//   (d) LABEL VALUES — snapshot emissions that carry label values (queue
//       names, degraded markers, publication states) match the closed sets.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  APPROVED_CORRELATION_FIELDS,
  BANNED_LOG_KEYS,
  METRIC_DEFINITIONS,
  PUBLICATION_STATES,
  QUEUE_NAMES,
  SNAPSHOT_SECTIONS,
  isBannedLogKey,
  labelValueAllowed,
  registeredSnapshotPaths,
} from '#/shared/observability/metrics-schema'
import { createOperationsSnapshot } from '#/shared/health/operations-snapshot'
import type { Database } from '#/shared/db'
import type { OutboxRepository } from '#/shared/outbox'

// ── (b) machinery: comment-preserving strip + logger call parser ──

/**
 * Replace comment characters with spaces, preserving newlines and total
 * length so file:line reporting stays exact. Strings/templates untouched.
 */
// A comment/string state machine — splitting it would scatter the state.
// Owner: BQC-7.3.
// fallow-ignore-next-line complexity
export function stripCommentsPreserveOffsets(source: string): string {
  const out = source.split('')
  let i = 0
  const n = source.length
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code'
  // Template literal `${}` nesting needs a stack: inside `${ … }` we are in
  // code state until the matching `}`.
  const templateDepth: number[] = []
  while (i < n) {
    const c = source[i]
    const next = source[i + 1]
    if (state === 'line') {
      if (c === '\n') state = 'code'
      else out[i] = ' '
      i++
      continue
    }
    if (state === 'block') {
      if (c === '*' && next === '/') {
        out[i] = ' '
        out[i + 1] = ' '
        i += 2
        state = 'code'
      } else {
        if (c !== '\n') out[i] = ' '
        i++
      }
      continue
    }
    if (state === 'single' || state === 'double' || state === 'template') {
      if (c === '\\') {
        i += 2
        continue
      }
      if (state === 'single' && c === "'") state = 'code'
      else if (state === 'double' && c === '"') state = 'code'
      else if (state === 'template') {
        if (c === '`') {
          if (templateDepth.length === 0) state = 'code'
          else {
            // closing a nested template inside ${}
            templateDepth.pop()
            state = 'code'
          }
        } else if (c === '$' && next === '{') {
          templateDepth.push(1)
          state = 'code'
          i += 2
          continue
        }
      }
      i++
      continue
    }
    // code state
    if (c === '/' && next === '/') {
      out[i] = ' '
      out[i + 1] = ' '
      i += 2
      state = 'line'
      continue
    }
    if (c === '/' && next === '*') {
      out[i] = ' '
      out[i + 1] = ' '
      i += 2
      state = 'block'
      continue
    }
    if (c === "'") state = 'single'
    else if (c === '"') state = 'double'
    else if (c === '`') state = 'template'
    else if (c === '}' && templateDepth.length > 0) {
      // Closing a ${ — if this } closes the interpolation, back to template.
      const top = templateDepth.pop()!
      if (top === 1) {
        state = 'template'
      } else {
        templateDepth.push(top - 1)
      }
    } else if (c === '{' && templateDepth.length > 0) {
      const top = templateDepth.pop()!
      templateDepth.push(top + 1)
    }
    i++
  }
  return out.join('')
}

const LOGGER_CALL =
  /(?:^|[^\w$])((?:[\w$]+\.)*?(?:logger|log)|getLogger\(\))\.(info|warn|error|debug|fatal|child)\s*\(/gi

type BannedHit = Readonly<{ file: string; line: number; key: string }>

/** Split a call argument list (starting at `start` = index of `(`) into args. */
// Balanced-delimiter scanner — the branches are the delimiter table.
// Owner: BQC-7.3.
// fallow-ignore-next-line complexity
function extractArguments(src: string, start: number): string[] {
  const args: string[] = []
  let depthParen = 0
  let depthBrace = 0
  let depthBracket = 0
  let argStart = start + 1
  let i = start
  const n = src.length
  let str: "'" | '"' | '`' | null = null
  while (i < n) {
    const c = src[i]
    if (str) {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === str) str = null
      i++
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      str = c as "'" | '"' | '`'
      i++
      continue
    }
    if (c === '(') depthParen++
    else if (c === ')') {
      depthParen--
      if (depthParen === 0) {
        args.push(src.slice(argStart, i))
        return args
      }
    } else if (c === '{') depthBrace++
    else if (c === '}') depthBrace--
    else if (c === '[') depthBracket++
    else if (c === ']') depthBracket--
    else if (c === ',' && depthParen === 1 && depthBrace === 0 && depthBracket === 0) {
      args.push(src.slice(argStart, i))
      argStart = i + 1
    }
    i++
  }
  return args
}

/**
 * Collect object-literal property keys (all nesting depths) from an argument
 * that is itself an object literal. Records `key:` and shorthand `{ key }`
 * forms; spread elements have no key and are skipped.
 */
// Object-literal key scanner — branches mirror the literal grammar.
// Owner: BQC-7.3.
// fallow-ignore-next-line complexity
function collectObjectKeys(arg: string): string[] {
  const keys: string[] = []
  let i = 0
  const n = arg.length
  let str: "'" | '"' | '`' | null = null
  // Stack entries: 'object' when the brace opened an object literal position,
  // 'block' otherwise (arrow bodies, class, etc. — rare inside log args).
  const braceKinds: Array<'object' | 'block'> = []
  let expectKey = false
  while (i < n) {
    const c = arg[i]
    if (str) {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === str) str = null
      i++
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      str = c as "'" | '"' | '`'
      i++
      continue
    }
    if (c === '{') {
      // A `{` in an object at key position is a destructuring/default value —
      // still an object literal for our purposes (values are scanned anyway).
      braceKinds.push('object')
      expectKey = true
      i++
      continue
    }
    if (c === '}') {
      braceKinds.pop()
      expectKey = false
      i++
      continue
    }
    if (c === ',' && braceKinds.length > 0) {
      expectKey = true
      i++
      continue
    }
    if (c === ':' && braceKinds.length > 0) {
      expectKey = false
      i++
      continue
    }
    if (expectKey && /[\w$]/.test(c)) {
      // Read the identifier / quoted key token.
      const m = /^[\w$]+/.exec(arg.slice(i))
      if (m) {
        const word = m[0]
        const after = arg.slice(i + word.length).trimStart()
        if (after.startsWith(':')) {
          keys.push(word)
          expectKey = false
        } else if (after.startsWith(',') || after.startsWith('}')) {
          keys.push(word) // shorthand property
          expectKey = false
        } else if (after.startsWith('(')) {
          expectKey = false // method definition — no data key
        }
        // else: spread or expression start — not a key; leave expectKey for ,
        i += word.length
        continue
      }
    }
    i++
  }
  return keys
}

function lineOf(src: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) if (src[i] === '\n') line++
  return line
}

function walkSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...walkSourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full)
    }
  }
  return files
}

/** Scan one source file for logger call objects carrying banned keys. */
export function scanFileForBannedLogKeys(file: string): BannedHit[] {
  const original = readFileSync(file, 'utf-8')
  const src = stripCommentsPreserveOffsets(original)
  const hits: BannedHit[] = []
  for (const match of src.matchAll(LOGGER_CALL)) {
    const openParen = match.index + match[0].length - 1
    for (const arg of extractArguments(src, openParen)) {
      if (!arg.trimStart().startsWith('{')) continue
      for (const key of collectObjectKeys(arg)) {
        if (isBannedLogKey(key)) {
          hits.push({ file, line: lineOf(src, match.index), key })
        }
      }
    }
  }
  return hits
}

// ── (a)/(d) machinery: real snapshot assembly with fakes ──

/** A thenable select-chain returning queued per-query results in call order. */
function fakeDb(results: unknown[][]): Database {
  let call = 0
  const makeChain = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.then = (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject)
    return chain
  }
  return { select: vi.fn(() => makeChain(results[call++] ?? [])) } as unknown as Database
}

/**
 * Snapshot leaf paths that are NOT metrics: timestamps, static queue-name
 * config echoes, queue-row name labels, and the degraded marker list itself.
 * Everything else must be registered in METRIC_DEFINITIONS.
 */
const NON_METRIC_PATHS = new Set([
  'timestamp',
  'workers.defaultQueueName',
  'workers.backgroundQueueName',
  'workers.domainEventsQueueName',
  'workers.heartbeat.at',
  'notifications.deliveryLag.oldestSourceRecordedAt',
  'notifications.deliveryLag.oldestMaterializationSourceRecordedAt',
  'notifications.deliveryLag.oldestMaterializationEnqueuedAt',
  'notifications.deliveryLag.immediateEmailAcceptance.oldestAwaitingSourceRecordedAt',
  'guestObservationLoss.ratingDisposition',
  'guestObservationLoss.windowMs',
  'guestObservationLoss.precisionMs',
  'queues.*.name',
  'jobs.rows.*.jobName',
  'jobs.rows.*.owner',
  'jobs.rows.*.cell',
  'jobs.rows.*.processor',
  'jobs.rows.*.action',
  'jobs.rows.*.routing',
  'jobs.rows.*.capability',
  'jobs.rows.*.posture',
  'jobs.rows.*.queue',
  'jobs.rows.*.schedule',
  'jobs.rows.*.retryAttempts',
  'jobs.rows.*.retryBackoff',
  'jobs.rows.*.timeoutMs',
  'jobs.rows.*.workerConcurrency',
  'jobs.rows.*.retention',
  'jobs.rows.*.lastSuccessObjectiveMs',
  'jobs.rows.*.maximumQueueAgeMs',
  'jobs.rows.*.ready',
  'jobs.rows.*.reasons.*',
  'jobs.rows.*.lastSucceededAt',
  'jobs.rows.*.oldestWaitingAt',
  'jobs.rows.*.deadLetterCount',
  'jobs.rows.*.repairCommand',
  'jobs.rows.*.runbook',
  'degraded.*',
])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Deep-walk a value into normalized leaf paths (array indices → `*`). */
function leafPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix}.*`]
    return value.flatMap((v) => leafPaths(v, `${prefix}.*`))
  }
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([k, v]) =>
      leafPaths(v, prefix ? `${prefix}.${k}` : k),
    )
  }
  return [prefix]
}

async function assembleSnapshot() {
  const reader = createOperationsSnapshot({
    db: fakeDb([
      [{ cnt: 1, age_ms: 10 }], // outbox unpublished
      [{ claimed: 0, oldest_claimed_age_ms: null, stalled: 0 }],
      [{ total: 1, refresh_due: 0, expired: 0, oldest_due_age_seconds: null }],
      [{ due: 2, failed: 0, oldest_due_age_ms: 900_000 }], // sync
      // reply publication aggregate (BQC-7.3)
      [
        {
          requested: 1,
          authorized: 0,
          sending: 0,
          published: 2,
          terminal: 0,
          ambiguous: 1,
          cancelled: 0,
          oldest_ambiguous_age_ms: 60_000,
        },
      ],
      // notification email queue aggregate (delivery health)
      [{ overdue: 1, oldest_overdue_age_ms: 120_000, attempted: 0 }],
    ]),
    outboxRepo: {
      findExpiredLeases: vi.fn(async () => []),
    } as unknown as OutboxRepository,
    queues: {
      default: {
        getJobCounts: vi.fn(async () => ({ waiting: 1 })),
      },
      background: null,
      domainEvents: null,
      quarantine: {
        getJobCounts: vi.fn(async () => ({ waiting: 1 })),
        getJobs: vi.fn(async () => []),
      },
    },
    redis: null,
    clock: () => new Date('2026-01-15T12:00:00.000Z'),
    versions: {
      capabilityPolicy: 'test-cap',
      executionPolicy: 'test-exec',
      policyStore: () => 7,
      routingPolicy: 1,
      sourceContentPolicy: 1,
    },
    // Hermetic runtime readers — the architecture gate must never open a
    // real DB pool (the production defaults would).
    runtime: {
      poolStats: () => ({ max: 10, totalCount: 2, idleCount: 1, waitingCount: 0 }),
      migrationVersion: async () => 17,
      releaseSha: () => 'unknown',
      tenantCache: () => ({ hits: 3, misses: 1, evictions: 0, size: 2 }),
    },
    jobRuntime: {
      read: async () => ({
        ready: false,
        total: 1,
        active: 1,
        dark: 0,
        quarantined: 0,
        failing: 1,
        missingObservations: 0,
        handlerMissing: 0,
        schedulerMissing: 1,
        forbiddenDarkWork: 0,
        quarantinedSchedulers: 0,
        missedObjectives: 0,
        queueAgeMissed: 0,
        stalled: 0,
        repairRequired: 0,
        deadLetters: 0,
        rows: [
          {
            jobName: 'health-check',
            owner: 'platform',
            cell: 'us',
            processor: 'src/shared/jobs/health-check.job.ts',
            action: 'system:health.check',
            routing: 'cell_local',
            capability: 'none',
            posture: 'active',
            queue: 'background',
            schedule: 'every:300000',
            retryAttempts: 3,
            retryBackoff: 'exponential:30000',
            timeoutMs: 30_000,
            workerConcurrency: 3,
            retention: 'completed:100,failed:50',
            lastSuccessObjectiveMs: 630_000,
            maximumQueueAgeMs: 900_000,
            ready: false,
            reasons: ['scheduler_missing'],
            lastSucceededAt: null,
            oldestWaitingAt: null,
            deadLetterCount: 0,
            repairCommand:
              'pnpm ops:quarantine redrive <quarantineJobId> --operator <registered-operator> --reason <incident-reason> --apply',
            runbook: 'docs/operations/runbooks.md',
          },
        ],
      }),
    },
    readGuestObservationLoss: async () => ({
      monitorAvailable: true,
      windowMs: 24 * 60 * 60 * 1000,
      precisionMs: 5 * 60 * 1000,
      scanLossCount: 1,
      reviewLinkLossCount: 2,
      ratingLossCount: 0,
      totalLossCount: 3,
      ratingDisposition: 'not_applicable_durable' as const,
    }),
  })
  return reader.read()
}

// ── The gate ──

describe('architecture: observability schema (BQC-7.3)', () => {
  it('(a) every OperationsSnapshot leaf path is registered in the schema', async () => {
    const snapshot = await assembleSnapshot()
    const registered = registeredSnapshotPaths()
    const unregistered = leafPaths(snapshot).filter(
      (p) => !registered.has(p) && !NON_METRIC_PATHS.has(p),
    )
    expect(
      unregistered,
      'snapshot fields must be registered in METRIC_DEFINITIONS:\n' +
        unregistered.join('\n'),
    ).toEqual([])
  })

  it('(a2) registered snapshot paths have no stale entries', async () => {
    const snapshot = await assembleSnapshot()
    const leaves = new Set(leafPaths(snapshot))
    const stale = [...registeredSnapshotPaths()].filter(
      (p) => !leaves.has(p) && !NON_METRIC_PATHS.has(p),
    )
    expect(
      stale,
      'schema snapshotPaths that do not resolve to a real snapshot field:\n' +
        stale.join('\n'),
    ).toEqual([])
  })

  it('(b) no logger call-site object contains a banned key', () => {
    const hits = walkSourceFiles('src').flatMap(scanFileForBannedLogKeys)
    const report = hits.map((h) => `${h.file}:${h.line} — banned key "${h.key}"`)
    expect(
      report,
      `logger call-sites must not log ${BANNED_LOG_KEYS.join('/')}:\n` +
        report.join('\n'),
    ).toEqual([])
  })

  it('(c) SpanAttrs declares no banned keys', () => {
    const src = readFileSync('src/shared/observability/request-context.ts', 'utf-8')
    const block = /export interface SpanAttrs \{([\s\S]*?)\}/.exec(src)
    expect(block, 'SpanAttrs interface must exist').not.toBeNull()
    const keys = [...block![1].matchAll(/(\w+)\??:/g)].map((m) => m[1])
    const banned = keys.filter(isBannedLogKey)
    expect(banned, `SpanAttrs must not carry ${banned.join('/')}`).toEqual([])
  })

  it('(policy) approved correlation fields are never banned; the banlist is duplicate-free', () => {
    for (const field of APPROVED_CORRELATION_FIELDS) {
      expect(isBannedLogKey(field), `${field} is an approved correlation field`).toBe(
        false,
      )
    }
    expect(new Set(BANNED_LOG_KEYS).size).toBe(BANNED_LOG_KEYS.length)
  })

  it('(d) snapshot label values match the closed sets', async () => {
    const snapshot = await assembleSnapshot()
    for (const row of snapshot.queues) {
      expect(
        (QUEUE_NAMES as readonly string[]).includes(row.name),
        `queue name "${row.name}" outside the closed set`,
      ).toBe(true)
    }
    for (const marker of snapshot.degraded) {
      expect(
        (SNAPSHOT_SECTIONS as readonly string[]).includes(marker),
        `degraded marker "${marker}" outside the closed set`,
      ).toBe(true)
    }
    for (const state of Object.keys(snapshot.replyPublication.counts)) {
      expect(
        (PUBLICATION_STATES as readonly string[]).includes(state),
        `publication state "${state}" outside the closed set`,
      ).toBe(true)
    }
    // Registry self-check: every label spec accepts its documented values.
    for (const def of METRIC_DEFINITIONS) {
      for (const [label, spec] of Object.entries(def.labels)) {
        if ('values' in spec) {
          expect(
            spec.values.length,
            `${def.name} label "${label}" must declare a closed value set`,
          ).toBeGreaterThan(0)
          for (const v of spec.values) {
            expect(labelValueAllowed(spec, v)).toBe(true)
          }
        }
      }
    }
  })
})
