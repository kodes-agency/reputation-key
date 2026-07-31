// BQC-8.1 — unit tests for the executable scenario runners.
//
// Hermetic: fake enqueue/removal seams, a controllable fake snapshot source,
// and virtual time (now/clock/sleep share one counter). These tests pin the
// measurement + assertion contract; the integration suite proves the seams
// against real DB+Redis.

import { describe, it, expect } from 'vitest'
import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'
import { SLOS } from './catalogue'
import {
  SCENARIO_EXECUTORS,
  FAULT_EXECUTORS,
  getScenarioExecutor,
  getFaultExecutor,
  type ScenarioRunEnv,
} from './executors'

const T0 = 1_752_435_200_000

function virtualTime() {
  let t = 0
  return {
    now: () => t,
    clock: () => new Date(T0 + t),
    sleep: async (ms: number) => {
      t += ms
    },
    advance: (ms: number) => {
      t += ms
    },
  }
}

function snapshotWithWaiting(waiting: number): OperationsSnapshot {
  return {
    timestamp: new Date(T0).toISOString(),
    outbox: {
      unpublishedCount: 0,
      oldestUnpublishedAgeMs: null,
      expiredLeaseCount: 0,
      claimedCount: 0,
      oldestClaimedAgeMs: null,
      stalledLeaseCount: 0,
    },
    quarantine: null,
    reviews: {
      totalActive: 0,
      refreshDueCount: 0,
      expiredCount: 0,
      oldestDueAgeSeconds: null,
    },
    sync: { dueForIncrementalCount: 0, failedSyncCount: 0 },
    replyPublication: {
      counts: {
        requested: 0,
        authorized: 0,
        sending: 0,
        published: 0,
        terminal: 0,
        ambiguous: 0,
        cancelled: 0,
      },
      oldestAmbiguousAgeMs: null,
    },
    workers: {
      defaultQueueName: 'default',
      backgroundQueueName: 'background',
      domainEventsQueueName: 'domain-events',
      heartbeat: { at: null, ageMs: null, stale: true },
    },
    queues: [{ name: 'default', waiting, active: 0, delayed: 0, failed: 0, paused: 0 }],
    db: { pool: null, migrationVersion: null },
    cache: { tenant: { hits: 0, misses: 0, evictions: 0, size: 0 } },
    release: { sha: 'test-sha' },
    versions: {
      capabilityPolicy: 'cap-1',
      policyStore: 1,
      routingPolicy: 1,
      sourceContentPolicy: 1,
      runtime: 'v22.0.0',
    },
    degraded: [],
  }
}

type FakeEnv = ScenarioRunEnv & {
  enqueuedIds: Array<string>
  removedIds: Array<string>
  failEnqueues: boolean
}

function fakeEnv(opts: {
  vt: ReturnType<typeof virtualTime>
  waiting?: number | ((read: number) => number)
  dashboardProbe?: () => Promise<void>
}): FakeEnv {
  let reads = 0
  const env: FakeEnv = {
    enqueuedIds: [],
    removedIds: [],
    failEnqueues: false,
    enqueue: async (_jobName, _data, jobId) => {
      if (env.failEnqueues) throw new Error('redis down')
      env.enqueuedIds.push(jobId)
    },
    removeJobs: async (ids) => {
      env.removedIds.push(...ids)
      return { removed: ids.length, missing: 0 }
    },
    snapshotSource: {
      read: async () => {
        reads += 1
        const waiting =
          typeof opts.waiting === 'function' ? opts.waiting(reads) : (opts.waiting ?? 0)
        return snapshotWithWaiting(waiting)
      },
    },
    dashboardProbe: opts.dashboardProbe,
    arrivalJob: {
      name: 'sync-property-reviews',
      data: (seq) => ({ seq }),
    },
    clock: opts.vt.clock,
    now: opts.vt.now,
    sleep: opts.vt.sleep,
    identity: {
      environment: 'local',
      releaseSha: 'test-sha',
      versions: {
        capabilityPolicy: 'cap-1',
        policyStore: 1,
        routingPolicy: 1,
        sourceContentPolicy: 1,
      },
    },
  }
  return env
}

describe('registry', () => {
  it('dispatches the executable subset and rejects unknown scenarios', () => {
    expect(getScenarioExecutor('steady')).toBe(SCENARIO_EXECUTORS.steady)
    expect(getScenarioExecutor('burst')).toBeDefined()
    expect(getScenarioExecutor('dashboardMix')).toBeDefined()
    expect(getScenarioExecutor('drain')).toBeDefined()
    // Catalogue scenarios without an executor resolve to undefined — the CLI
    // fails closed on them instead of pretending to run.
    expect(getScenarioExecutor('retention')).toBeUndefined()
  })

  it('has a fault registry slot for 8.4/8.5 but no executors yet', () => {
    expect(FAULT_EXECUTORS).toEqual({})
    expect(getFaultExecutor('redisUnavailable')).toBeUndefined()
  })
})

describe('steady executor', () => {
  it('paces enqueues at the target rate and passes with monitoring', async () => {
    const vt = virtualTime()
    const env = fakeEnv({ vt })
    const outcome = await SCENARIO_EXECUTORS.steady!(env, {
      ratePerSec: 100,
      durationS: 2,
      pollIntervalMs: 500,
    })
    const { record, raw } = outcome
    // 100/s × 2s = 200 samples; pacing consumes only virtual sleep time.
    expect(raw.samples).toHaveLength(200)
    expect(record.scenario).toBe('steady')
    expect(record.passed).toBe(true)
    expect(record.metrics.targetRatePerSec).toBe(100)
    expect(Number(record.metrics.achievedRatePerSec)).toBeGreaterThanOrEqual(80)
    expect(record.samples).toEqual({ count: 200, errors: 0 })
    // 2s run at 500ms poll → 4 ticks + the final tick.
    expect(record.monitoring.points).toBeGreaterThanOrEqual(4)
    expect(record.assertions.map((a) => a.check)).toEqual([
      'required_samples',
      'enqueue_error_free',
      'rate_achieved',
      'monitoring_captured',
    ])
    // Cleanup removed exactly the enqueued jobs.
    expect(env.removedIds.sort()).toEqual(env.enqueuedIds.sort())
    // Identity + SLO snapshot travel with the record.
    expect(record.releaseSha).toBe('test-sha')
    expect(record.slo).toMatchObject({ rate: SLOS.steadyReviewRate })
    // Job ids are unique per run.
    expect(new Set(env.enqueuedIds).size).toBe(env.enqueuedIds.length)
  })

  it('fails the run when enqueues error (no silent loss)', async () => {
    const vt = virtualTime()
    const env = fakeEnv({ vt })
    env.failEnqueues = true
    const outcome = await SCENARIO_EXECUTORS.steady!(env, {
      ratePerSec: 50,
      durationS: 1,
    })
    expect(outcome.record.passed).toBe(false)
    expect(outcome.record.samples.errors).toBe(50)
    const check = outcome.record.assertions.find((a) => a.check === 'enqueue_error_free')
    expect(check?.passed).toBe(false)
  })

  it('fails rate_achieved when the seam cannot sustain the target rate', async () => {
    const vt = virtualTime()
    const base = fakeEnv({ vt })
    const slowEnqueue = base.enqueue
    // Wrapped env: each enqueue burns 30ms of virtual time → max ~33/s.
    const env: FakeEnv = {
      ...base,
      enqueue: async (jobName, data, jobId) => {
        vt.advance(30)
        await slowEnqueue(jobName, data, jobId)
      },
    }
    const outcome = await SCENARIO_EXECUTORS.steady!(env, {
      ratePerSec: 100,
      durationS: 1,
    })
    const check = outcome.record.assertions.find((a) => a.check === 'rate_achieved')
    expect(check?.passed).toBe(false)
    expect(outcome.record.passed).toBe(false)
  })
})

describe('burst executor', () => {
  it('uses the catalogue rate/duration defaults and asserts no duplicates', async () => {
    const vt = virtualTime()
    const env = fakeEnv({ vt })
    const outcome = await SCENARIO_EXECUTORS.burst!(env, {
      durationS: 1,
      pollIntervalMs: 250,
    })
    expect(outcome.record.metrics.targetRatePerSec).toBe(SLOS.burstReviewRate)
    // Overridden to 1s for the test → 100 samples at the catalogue rate.
    expect(outcome.record.samples.count).toBe(100)
    expect(
      outcome.record.assertions.find((a) => a.check === 'no_duplicates')?.passed,
    ).toBe(true)
    expect(outcome.record.passed).toBe(true)
  })
})

describe('dashboardMix executor', () => {
  it('requires a dashboard probe (fails closed without a read path)', async () => {
    const vt = virtualTime()
    const env = fakeEnv({ vt })
    await expect(SCENARIO_EXECUTORS.dashboardMix!(env, { durationS: 1 })).rejects.toThrow(
      /dashboard probe/,
    )
  })

  it('measures concurrent reads against the warm budget', async () => {
    const vt = virtualTime()
    const env = fakeEnv({
      vt,
      dashboardProbe: async () => {
        vt.advance(5)
      },
    })
    const outcome = await SCENARIO_EXECUTORS.dashboardMix!(env, {
      durationS: 1,
      concurrency: 4,
      pollIntervalMs: 250,
    })
    const { record } = outcome
    expect(record.scenario).toBe('dashboardMix')
    expect(record.samples.count).toBeGreaterThan(0)
    expect(Number(record.metrics.readP95)).toBeLessThanOrEqual(SLOS.dashboardP95)
    expect(
      record.assertions.find((a) => a.check === 'warm_p95_within_budget')?.passed,
    ).toBe(true)
    expect(record.passed).toBe(true)
  })
})

describe('drain executor', () => {
  it('measures time-to-empty and passes when the backlog drains in time', async () => {
    const vt = virtualTime()
    // Fake worker: the backlog drains 25 jobs per poll read.
    let remaining = 100
    const env = fakeEnv({
      vt,
      waiting: () => {
        remaining = Math.max(0, remaining - 25)
        return remaining
      },
    })
    const outcome = await SCENARIO_EXECUTORS.drain!(env, {
      backlogSize: 100,
      timeoutS: 60,
      pollIntervalMs: 1000,
    })
    const { record } = outcome
    expect(record.scenario).toBe('drain')
    expect(record.passed).toBe(true)
    expect(record.metrics.backlogSize).toBe(100)
    expect(Number(record.metrics.drainMs)).toBeGreaterThan(0)
    expect(record.metrics.remainingWaiting).toBe(0)
    expect(
      record.assertions.find((a) => a.check === 'drained_within_timeout')?.passed,
    ).toBe(true)
    // Cleanup still swept exactly the injected jobs (idempotent removals).
    expect(env.removedIds.sort()).toEqual(env.enqueuedIds.sort())
  })

  it('honestly fails when nothing drains the backlog within the timeout', async () => {
    const vt = virtualTime()
    const env = fakeEnv({ vt, waiting: 100 }) // no worker — depth never moves
    const outcome = await SCENARIO_EXECUTORS.drain!(env, {
      backlogSize: 100,
      timeoutS: 5,
      pollIntervalMs: 1000,
    })
    const { record } = outcome
    expect(record.passed).toBe(false)
    expect(record.metrics.remainingWaiting).toBe(100)
    const check = record.assertions.find((a) => a.check === 'drained_within_timeout')
    expect(check?.passed).toBe(false)
    // The environment is left clean even on a failed measurement.
    expect(env.removedIds).toHaveLength(100)
  })
})
