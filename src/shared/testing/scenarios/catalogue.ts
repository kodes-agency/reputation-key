// BQC-8.1 — scenario/fault catalogue: the single source of truth for SLOs,
// load scenarios, and fault injections (PRE17C §9.2-9.3, ADR 0038 numbers).
//
// Moved out of scripts/perf/load-test.ts so executors, the CLI, and the
// evidence ingester import one governed inventory. The catalogue is DATA
// plus the result contracts only — execution lives in ./executors.ts, CLI
// wiring in scripts/perf/.
//
// Contract discipline (the honesty rule of this slice):
//   - A ScenarioRunRecord is written ONLY by an executor that actually ran.
//   - `slo` snapshots the thresholds applied, so evidence never re-derives
//     pass/fail from a drifted catalogue.
//   - `samples`/`monitoring` counts are part of the record — the evidence
//     ingester fails closed when either is zero.

import type { Clock } from '#/shared/domain/clock'

// ── SLO definitions (from PRE17C plan §2.1, §9.2) ──────────────────

export const SLOS = {
  // Throughput targets
  steadyReviewRate: 20, // reviews/sec sustained
  burstReviewRate: 100, // reviews/sec for 60s
  burstDuration: 60, // seconds

  // Recovery targets
  drainTimeout: 600, // 10 minutes after burst
  rpoTarget: 900, // ≤ 15 minutes data loss tolerance
  rtoTarget: 14_400, // ≤ 4 hours recovery time

  // Dashboard query budgets
  dashboardP95: 500, // ms, warm cache
  dashboardColdP95: 2000, // ms, cold cache

  // Queue health
  maxQueueDepth: 10_000, // alerts above this
  outboxLagP95: 5000, // ms, relay must process within this

  // Fleet scheduling
  fleetProperties: 5000,
  fleetWindow: 4, // hours to dispatch all

  // BQC-8.2 capacity executions (ADR 0038 + phase doc §8.2)
  replyPublishTerminalP95: 10_000, // ms — "Reply publish → terminal status visible p95 ≤ 10s" (ADR 0038)
  replyBurstSize: 25, // replies — a burst within human-use expectations
  reconnectOutage: 30, // s — simulated provider outage window before catch-up
  hotPropertyBurstRate: 100, // reviews/s concentrated on ONE hot property
  backgroundRateFloor: 0.8, // tenant fairness: background ≥ 80% of target under a hot burst
} as const

// ── Scenario definitions ───────────────────────────────────────────

export type ScenarioResult = {
  scenario: string
  startedAt: string
  durationMs: number
  passed: boolean
  metrics: Record<string, number | string>
  assertions: Array<{ check: string; passed: boolean; detail?: string }>
}

export const SCENARIOS = {
  steady: {
    name: 'Steady arrival',
    description: '20 review facts/sec for 30 minutes',
    slo: {
      rate: SLOS.steadyReviewRate,
      duration: 30 * 60, // 30 minutes
      noLoss: true,
    },
  },
  burst: {
    name: 'Burst',
    description: '100 reviews/sec for 60 seconds',
    slo: {
      rate: SLOS.burstReviewRate,
      duration: SLOS.burstDuration,
      expectedAccepted: 6000,
      noDuplicates: true,
      drainTimeout: SLOS.drainTimeout,
    },
  },
  drain: {
    name: 'Backlog drain',
    description: 'Inject a backlog, stop injection, measure time-to-empty',
    slo: {
      drainTimeout: SLOS.drainTimeout,
      boundedDepth: SLOS.maxQueueDepth,
    },
  },
  singlePropertyBurst: {
    name: 'Single-property burst',
    description:
      'Burst concentrated on ONE hot property while steady background arrival continues on the fleet',
    slo: {
      backgroundRate: SLOS.steadyReviewRate,
      hotRate: SLOS.hotPropertyBurstRate,
      duration: SLOS.burstDuration,
      backgroundRateFloor: SLOS.backgroundRateFloor,
      boundedDepth: SLOS.maxQueueDepth,
    },
  },
  reconnect: {
    name: 'Reconnect/import',
    description:
      'Simulated provider outage (injection paused, worker live), then reconnect catch-up burst and drain',
    slo: {
      outageDuration: SLOS.reconnectOutage,
      catchUpRate: SLOS.burstReviewRate,
      drainTimeout: SLOS.drainTimeout,
      noDuplicates: true,
      noLoss: true,
    },
  },
  fleetDispatch: {
    name: 'Fleet dispatch',
    description:
      'Dispatch refresh-due work for the whole seeded fleet; measured rate + LABELED 4h-window projection',
    slo: {
      fleetProperties: SLOS.fleetProperties,
      fleetWindowHours: SLOS.fleetWindow,
      projectionLabeled: true,
    },
  },
  dashboardMix: {
    name: 'Dashboard mix',
    description: 'Warm/cold 1/7/30/90-day property views',
    slo: {
      warmP95: SLOS.dashboardP95,
      coldP95: SLOS.dashboardColdP95,
      noLeakage: true,
    },
  },
  dashboardCold: {
    name: 'Dashboard cold start',
    description: 'First-N reads through a freshly restarted read path (cache cold start)',
    slo: {
      coldP95: SLOS.dashboardColdP95,
      firstReads: 20,
    },
  },
  replyBurst: {
    name: 'Reply publication burst',
    description:
      'A human-use burst of reply publications; publish → terminal p95 (ADR 0038)',
    slo: {
      burstSize: SLOS.replyBurstSize,
      publishTerminalP95: SLOS.replyPublishTerminalP95,
    },
  },
  retention: {
    name: 'Retention/deletion',
    description: 'Expire and disconnect large properties during arrival',
    slo: {
      completePurge: true,
      noResurrection: true,
    },
  },
  reconciliation: {
    name: 'Reconciliation',
    description: '35-day aggregate repair while traffic continues',
    slo: {
      boundedImpact: true,
      exactRepair: true,
    },
  },
} as const

export type ScenarioName = keyof typeof SCENARIOS

// ── Fault injection definitions (§9.3) ─────────────────────────────

export const FAULTS = {
  dbFailurePreCommit: {
    name: 'Database failure before source commit',
    trigger: 'Kill PostgreSQL during outbox transaction',
    invariant: 'No orphan outbox rows; all commits are atomic',
    expectedRecovery: 'Retry from outbox; no data loss',
  },
  dbFailurePostCommit: {
    name: 'Database failure after source commit',
    trigger: 'Kill PostgreSQL after INSERT but before outbox publish',
    invariant: 'Outbox relay catches up on restart',
    expectedRecovery: 'RPO ≤ 15 minutes',
  },
  relayCrashAfterClaim: {
    name: 'Relay crash after claim',
    trigger: 'SIGKILL relay after claiming outbox rows',
    invariant: 'Lease expires; rows re-claimed by next relay',
    expectedRecovery: 'No lost events; idempotent delivery',
  },
  relayCrashAfterRedis: {
    name: 'Relay crash after Redis add',
    trigger: 'SIGKILL relay after enqueueing to BullMQ',
    invariant: 'Duplicate possible but receipt dedup handles it',
    expectedRecovery: 'No duplicate side effects',
  },
  redisUnavailable: {
    name: 'Redis unavailable',
    trigger: 'Block Redis port for 30 seconds',
    invariant: 'Outbox accumulates; web stays healthy',
    expectedRecovery: 'Relay drains backlog on Redis recovery',
  },
  workerSigterm: {
    name: 'Worker SIGTERM during handler',
    trigger: 'Send SIGTERM during active review processing',
    invariant: 'Job re-queued; outbox intact',
    expectedRecovery: 'Clean drain within deadline',
  },
  workerForceKill: {
    name: 'Worker forced termination',
    trigger: 'SIGKILL during handler execution',
    invariant: 'Outbox row unclaimed; job retried',
    expectedRecovery: 'Idempotent retry; no corruption',
  },
  duplicateEvents: {
    name: 'Duplicate/out-of-order events',
    trigger: 'Send same event twice with different timestamps',
    invariant: 'Receipt dedup prevents duplicate processing',
    expectedRecovery: 'Exactly-once side effects',
  },
  poisonPayload: {
    name: 'Poison payload',
    trigger: 'Send malformed event to dispatcher',
    invariant: 'Dead-lettered; other events unaffected',
    expectedRecovery: 'Quarantine + alert; pipeline continues',
  },
  gbpRateLimit: {
    name: 'GBP 429 rate limit',
    trigger: 'Mock GBP API returning 429 with Retry-After',
    invariant: 'Backoff; no hammering',
    expectedRecovery: 'Retries with delay; sync paused',
  },
  cacheOutage: {
    name: 'Cache outage and stampede',
    trigger: 'Flush Redis cache during burst',
    invariant: 'Fallback to DB; bounded query load',
    expectedRecovery: 'Cache warms; no cascade failure',
  },
  lifecyclePurgeRace: {
    name: 'Lifecycle purge racing sync',
    trigger: 'Trigger content expiry during active sync',
    invariant: 'No resurrection of purged content',
    expectedRecovery: 'Sync detects missing content; skips',
  },
} as const

export type FaultName = keyof typeof FAULTS

// ── Run record contract (executor output; evidence ingester input) ──

/** Deploy + policy identity captured at run time (content-free). */
export type RunVersions = Readonly<{
  capabilityPolicy: string
  policyStore: number | null
  routingPolicy: number
  sourceContentPolicy: number
}>

/**
 * BQC-8.2: what the run captured from OUTSIDE the app-readable snapshot.
 * Never a silent gap: every record states exactly which platform surfaces
 * were collected and which were not (DB CPU/locks are platform-observability
 * acceptance surfaces, not app-readable).
 */
export type CollectorCoverage = Readonly<{
  redisInfo: 'redis-cli' | 'not-collected-in-this-environment'
  dbCpuLocks: 'not-collected-in-this-environment'
}>

/**
 * What an executed scenario writes to `<scenario>.result.json`. Extends the
 * catalogue ScenarioResult with the environment/identity/threshold context
 * the evidence ingester needs to review a run without re-derivation.
 */
export type ScenarioRunRecord = ScenarioResult &
  Readonly<{
    /** Execution environment label, e.g. 'local' (low-cardinality). */
    environment: string
    releaseSha: string
    versions: RunVersions
    /** The thresholds the run asserted against (catalogue snapshot). */
    slo: Record<string, number | string | boolean>
    samples: Readonly<{ count: number; errors: number }>
    monitoring: Readonly<{ points: number; readErrors: number }>
    /** External collector coverage statement (BQC-8.2) — always present. */
    collectors: CollectorCoverage
  }>

export function createResult(
  scenario: string,
  durationMs: number,
  metrics: Record<string, number | string>,
  assertions: Array<{ check: string; passed: boolean; detail?: string }>,
  clock: Clock,
): ScenarioResult {
  return {
    scenario,
    startedAt: clock().toISOString(),
    durationMs,
    passed: assertions.every((a) => a.passed),
    metrics,
    assertions,
  }
}

// ── Result record store (JSON) ─────────────────────────────────────

/** Result store format version — bump on any shape change; parsers fail closed. */
export const RESULT_STORE_VERSION = 2 as const

export function serializeResult(record: ScenarioRunRecord): string {
  return JSON.stringify({ version: RESULT_STORE_VERSION, ...record }, null, 2)
}

/** Parse a scenario result file. Throws on any shape/version drift. */
export function parseResult(json: string): ScenarioRunRecord {
  const parsed = JSON.parse(json) as unknown
  if (typeof parsed !== 'object' || parsed == null)
    throw new Error('scenario result: not an object')
  const r = parsed as Record<string, unknown>
  if (r.version !== RESULT_STORE_VERSION)
    throw new Error(`scenario result: unsupported version ${String(r.version)}`)
  const samples = r.samples as Record<string, unknown> | undefined
  const monitoring = r.monitoring as Record<string, unknown> | undefined
  const versions = r.versions as Record<string, unknown> | undefined
  const collectors = r.collectors as Record<string, unknown> | undefined
  if (
    typeof r.scenario !== 'string' ||
    typeof r.startedAt !== 'string' ||
    typeof r.durationMs !== 'number' ||
    typeof r.passed !== 'boolean' ||
    typeof r.environment !== 'string' ||
    typeof r.releaseSha !== 'string' ||
    typeof r.metrics !== 'object' ||
    r.metrics == null ||
    !Array.isArray(r.assertions) ||
    typeof r.slo !== 'object' ||
    r.slo == null ||
    typeof samples?.count !== 'number' ||
    typeof samples?.errors !== 'number' ||
    typeof monitoring?.points !== 'number' ||
    typeof monitoring?.readErrors !== 'number' ||
    typeof versions?.capabilityPolicy !== 'string' ||
    typeof versions?.routingPolicy !== 'number' ||
    typeof versions?.sourceContentPolicy !== 'number' ||
    typeof collectors?.redisInfo !== 'string' ||
    collectors?.dbCpuLocks !== 'not-collected-in-this-environment'
  )
    throw new Error('scenario result: shape mismatch')
  const { version: _version, ...record } = r
  return record as unknown as ScenarioRunRecord
}
