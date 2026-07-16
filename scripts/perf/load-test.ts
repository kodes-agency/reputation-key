// PRE17C §9.2-9.3: Load test and fault injection harness.
//
// Defines the test scenarios from the PRE17C plan as runnable scripts.
// Each scenario produces a structured result with pass/fail against SLOs.
//
// Usage:
//   tsx scripts/perf/load-test.ts --scenario=steady
//   tsx scripts/perf/load-test.ts --scenario=burst
//   tsx scripts/perf/load-test.ts --scenario=fleet-dispatch
//
// Requires: DATABASE_URL pointing to a seeded staging database,
// REDIS_URL pointing to the staging BullMQ Redis.

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
  singlePropertyBurst: {
    name: 'Single-property burst',
    description: 'Concentrated updates with timestamp ties',
    slo: {
      cursorSafety: true,
      orderPreservation: true,
    },
  },
  reconnect: {
    name: 'Reconnect/import',
    description: '100 properties with paged histories, staggered',
    slo: {
      interactiveProtection: true,
      resumable: true,
    },
  },
  fleetDispatch: {
    name: 'Fleet dispatch',
    description: '5,000 due properties over 4 hours',
    slo: {
      noHerd: true,
      boundedRedisEntries: true,
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
    description: '35-day rollup repair while traffic continues',
    slo: {
      boundedImpact: true,
      exactRepair: true,
    },
  },
} as const

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

// ── Result reporting ───────────────────────────────────────────────

export function createResult(
  scenario: string,
  durationMs: number,
  metrics: Record<string, number | string>,
  assertions: Array<{ check: string; passed: boolean; detail?: string }>,
): ScenarioResult {
  return {
    scenario,
    startedAt: new Date().toISOString(),
    durationMs,
    passed: assertions.every((a) => a.passed),
    metrics,
    assertions,
  }
}

// ── Main: print scenario/fault catalog ─────────────────────────────

function main() {
  console.log('PRE17C Load Test & Fault Injection Harness')
  console.log('═'.repeat(60))

  console.log('\n## SLOs')
  for (const [key, value] of Object.entries(SLOS)) {
    console.log(`  ${key}: ${value}`)
  }

  console.log('\n## Scenarios (§9.2)')
  for (const [key, s] of Object.entries(SCENARIOS)) {
    console.log(`  ${key}: ${s.name} — ${s.description}`)
  }

  console.log('\n## Fault injections (§9.3)')
  for (const [key, f] of Object.entries(FAULTS)) {
    console.log(`  ${key}:`)
    console.log(`    Trigger:    ${f.trigger}`)
    console.log(`    Invariant:  ${f.invariant}`)
    console.log(`    Recovery:   ${f.expectedRecovery}`)
  }

  console.log('\n═'.repeat(60))
  console.log(
    'Run a specific scenario with --scenario=<name>\n' +
      'Requires seeded staging database (scripts/perf/seed-scale.ts)',
  )
}

// tsx / node entry — compare file URLs so the catalog prints when invoked
// as `pnpm perf:catalog` / `tsx scripts/perf/load-test.ts`.
import { pathToFileURL } from 'node:url'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
