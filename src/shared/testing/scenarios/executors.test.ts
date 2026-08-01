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
  hotIds: Array<string>
  restarts: number
  publishedIds: Array<string>
  cleanedUp: boolean
}

function fakeEnv(opts: {
  vt: ReturnType<typeof virtualTime>
  waiting?: number | ((read: number) => number)
  dashboardProbe?: () => Promise<void>
  withHotJob?: boolean
  restartReadPath?: () => Promise<void>
  replyPublication?: ScenarioRunEnv['replyPublication']
  externalCollector?: ScenarioRunEnv['externalCollector']
}): FakeEnv {
  let reads = 0
  const env: FakeEnv = {
    enqueuedIds: [],
    removedIds: [],
    hotIds: [],
    restarts: 0,
    publishedIds: [],
    cleanedUp: false,
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
    hotArrivalJob: opts.withHotJob
      ? { name: 'sync-property-reviews', data: () => ({ hot: true }) }
      : undefined,
    restartReadPath: opts.restartReadPath,
    replyPublication: opts.replyPublication,
    externalCollector: opts.externalCollector,
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
    // BQC-8.2 capacity executors.
    expect(getScenarioExecutor('singlePropertyBurst')).toBeDefined()
    expect(getScenarioExecutor('reconnect')).toBeDefined()
    expect(getScenarioExecutor('fleetDispatch')).toBeDefined()
    expect(getScenarioExecutor('dashboardCold')).toBeDefined()
    expect(getScenarioExecutor('replyBurst')).toBeDefined()
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

// ── BQC-8.2 capacity executors ──────────────────────────────────────

describe('singlePropertyBurst executor', () => {
  it('fails closed without a hot-property job seam', async () => {
    const vt = virtualTime()
    const env = fakeEnv({ vt })
    await expect(
      SCENARIO_EXECUTORS.singlePropertyBurst!(env, { durationS: 1 }),
    ).rejects.toThrow(/hot/i)
  })

  it('bursts one hot property while background arrival continues (no starvation)', async () => {
    const vt = virtualTime()
    const env = fakeEnv({ vt, withHotJob: true, waiting: 5 })
    const outcome = await SCENARIO_EXECUTORS.singlePropertyBurst!(env, {
      ratePerSec: 100,
      hotRatePerSec: 100,
      durationS: 1,
      pollIntervalMs: 250,
    })
    const { record, raw } = outcome
    expect(record.scenario).toBe('singlePropertyBurst')
    expect(record.passed).toBe(true)
    const background = raw.samples.filter((s) => s.name === 'enqueue-background')
    const hot = raw.samples.filter((s) => s.name === 'enqueue-hot')
    expect(background.length).toBeGreaterThanOrEqual(80)
    expect(hot.length).toBeGreaterThanOrEqual(80)
    expect(record.assertions.map((a) => a.check)).toEqual([
      'required_samples',
      'hot_samples_land',
      'background_error_free',
      'background_rate_no_starvation',
      'queue_depth_bounded',
      'monitoring_captured',
    ])
    expect(Number(record.metrics.backgroundAchievedRatePerSec)).toBeGreaterThanOrEqual(80)
    expect(Number(record.metrics.hotAchievedRatePerSec)).toBeGreaterThanOrEqual(80)
    // Hot + background job ids are disjoint, unique, and all swept.
    expect(env.removedIds.sort()).toEqual(env.enqueuedIds.sort())
    expect(new Set(env.enqueuedIds).size).toBe(env.enqueuedIds.length)
    expect(env.enqueuedIds.some((id) => id.includes('-hot-'))).toBe(true)
    expect(env.enqueuedIds.some((id) => id.includes('-bg-'))).toBe(true)
  })

  it('fails background_rate_no_starvation when background arrival starves', async () => {
    const vt = virtualTime()
    const base = fakeEnv({ vt, withHotJob: true, waiting: 5 })
    const slowEnqueue = base.enqueue
    // Background enqueues burn 30ms each (hot stays instant) → bg ≪ 80% target.
    const env: FakeEnv = {
      ...base,
      enqueue: async (jobName, data, jobId) => {
        if (!(data as { hot?: boolean }).hot) vt.advance(30)
        await slowEnqueue(jobName, data, jobId)
      },
    }
    const outcome = await SCENARIO_EXECUTORS.singlePropertyBurst!(env, {
      ratePerSec: 100,
      hotRatePerSec: 100,
      durationS: 1,
      pollIntervalMs: 250,
    })
    const check = outcome.record.assertions.find(
      (a) => a.check === 'background_rate_no_starvation',
    )
    expect(check?.passed).toBe(false)
    expect(outcome.record.passed).toBe(false)
  })

  it('fails queue_depth_bounded when the queue exceeds the SLO depth', async () => {
    const vt = virtualTime()
    const env = fakeEnv({ vt, withHotJob: true, waiting: 20_000 })
    const outcome = await SCENARIO_EXECUTORS.singlePropertyBurst!(env, {
      ratePerSec: 100,
      hotRatePerSec: 100,
      durationS: 1,
      pollIntervalMs: 250,
    })
    const check = outcome.record.assertions.find((a) => a.check === 'queue_depth_bounded')
    expect(check?.passed).toBe(false)
    expect(outcome.record.metrics.maxQueueWaiting).toBe(20_000)
  })
})

describe('reconnect executor', () => {
  it('runs baseline → outage → catch-up → drain and reconciles counts', async () => {
    const vt = virtualTime()
    let waiting = 0
    const env = fakeEnv({
      vt,
      waiting: () => {
        waiting = Math.max(0, waiting - 50)
        return waiting
      },
    })
    const outcome = await SCENARIO_EXECUTORS.reconnect!(env, {
      ratePerSec: 100,
      baselineS: 1,
      outageS: 1,
      hotRatePerSec: 100,
      timeoutS: 60,
      pollIntervalMs: 250,
    })
    const { record, raw } = outcome
    expect(record.scenario).toBe('reconnect')
    expect(record.passed).toBe(true)
    expect(record.assertions.map((a) => a.check)).toEqual([
      'required_samples',
      'baseline_error_free',
      'catchup_error_free',
      'no_duplicates',
      'no_loss',
      'catchup_drained_within_slo',
      'monitoring_captured',
    ])
    // Outage markers bracket the pause in the raw series.
    const markers = raw.samples.filter((s) => s.name === 'outage-window')
    expect(markers).toHaveLength(2)
    // Baseline 100 + catch-up 100 enqueues, all swept.
    expect(env.enqueuedIds).toHaveLength(200)
    expect(env.removedIds.sort()).toEqual(env.enqueuedIds.sort())
    expect(Number(record.metrics.catchUpDrainMs)).toBeGreaterThanOrEqual(0)
    expect(record.metrics.remainingWaiting).toBe(0)
  })

  it('honestly fails when the catch-up backlog does not drain in time', async () => {
    const vt = virtualTime()
    const env = fakeEnv({ vt, waiting: 500 })
    const outcome = await SCENARIO_EXECUTORS.reconnect!(env, {
      ratePerSec: 100,
      baselineS: 1,
      outageS: 1,
      hotRatePerSec: 100,
      timeoutS: 1,
      pollIntervalMs: 250,
    })
    const { record } = outcome
    expect(record.passed).toBe(false)
    expect(
      record.assertions.find((a) => a.check === 'catchup_drained_within_slo')?.passed,
    ).toBe(false)
    expect(record.assertions.find((a) => a.check === 'no_loss')?.passed).toBe(false)
    // Still swept exactly the run's own jobs.
    expect(env.removedIds.sort()).toEqual(env.enqueuedIds.sort())
  })
})

describe('fleetDispatch executor', () => {
  it('dispatches the fleet, records the measured rate and a LABELED projection', async () => {
    const vt = virtualTime()
    const env = fakeEnv({ vt, waiting: 0 })
    const outcome = await SCENARIO_EXECUTORS.fleetDispatch!(env, {
      fleetSize: 50,
      pollIntervalMs: 250,
    })
    const { record, raw } = outcome
    expect(record.scenario).toBe('fleetDispatch')
    expect(record.passed).toBe(true)
    expect(raw.samples.filter((s) => s.name === 'dispatch')).toHaveLength(50)
    expect(record.metrics.fleetTargets).toBe(50)
    expect(Number(record.metrics.dispatchRatePerSec)).toBeGreaterThan(0)
    expect(String(record.metrics.projection)).toMatch(/projection/i)
    const check = record.assertions.find((a) => a.check === 'projected_window_within_slo')
    expect(check?.passed).toBe(true)
    expect(check?.detail).toMatch(/PROJECTION/i)
    expect(env.removedIds.sort()).toEqual(env.enqueuedIds.sort())
  })
})

describe('dashboardCold executor', () => {
  it('fails closed without a restart seam or a dashboard probe', async () => {
    const vt = virtualTime()
    await expect(
      SCENARIO_EXECUTORS.dashboardCold!(fakeEnv({ vt, dashboardProbe: async () => {} }), {
        reads: 5,
      }),
    ).rejects.toThrow(/restart/i)
    await expect(
      SCENARIO_EXECUTORS.dashboardCold!(
        fakeEnv({ vt, restartReadPath: async () => {} }),
        { reads: 5 },
      ),
    ).rejects.toThrow(/dashboard probe/i)
  })

  it('restarts the read path once, then measures first-N cold reads', async () => {
    const vt = virtualTime()
    let restarts = 0
    const env = fakeEnv({
      vt,
      restartReadPath: async () => {
        restarts += 1
      },
      dashboardProbe: async () => {
        vt.advance(5)
      },
    })
    const outcome = await SCENARIO_EXECUTORS.dashboardCold!(env, {
      reads: 20,
      pollIntervalMs: 250,
    })
    const { record, raw } = outcome
    expect(restarts).toBe(1)
    expect(record.scenario).toBe('dashboardCold')
    expect(record.passed).toBe(true)
    expect(raw.samples.filter((s) => s.name === 'dashboard-cold-read')).toHaveLength(20)
    expect(Number(record.metrics.readP95)).toBeLessThanOrEqual(SLOS.dashboardColdP95)
    expect(String(record.metrics.coldBasis)).toMatch(/fresh/i)
    expect(
      record.assertions.find((a) => a.check === 'cold_p95_within_budget')?.passed,
    ).toBe(true)
  })

  it('fails cold_p95_within_budget when first reads exceed the cold budget', async () => {
    const vt = virtualTime()
    const env = fakeEnv({
      vt,
      restartReadPath: async () => {},
      dashboardProbe: async () => {
        vt.advance(3_000)
      },
    })
    const outcome = await SCENARIO_EXECUTORS.dashboardCold!(env, {
      reads: 3,
      pollIntervalMs: 250,
    })
    expect(
      outcome.record.assertions.find((a) => a.check === 'cold_p95_within_budget')?.passed,
    ).toBe(false)
    expect(outcome.record.passed).toBe(false)
  })
})

describe('replyBurst executor', () => {
  function fakeReplySeam(opts: { terminalAtPoll: number | null }): {
    seam: NonNullable<ScenarioRunEnv['replyPublication']>
    published: string[]
    cleaned: boolean
    setCleaned: () => void
  } {
    let polls = 0
    const published: string[] = []
    const state = { cleaned: false }
    return {
      published,
      get cleaned() {
        return state.cleaned
      },
      setCleaned: () => {
        state.cleaned = true
      },
      seam: {
        prepare: async (count) => Array.from({ length: count }, (_, i) => `reply-${i}`),
        enqueuePublish: async (replyId) => {
          published.push(replyId)
        },
        publicationStates: async (ids) => {
          polls += 1
          const terminal = opts.terminalAtPoll != null && polls >= opts.terminalAtPoll
          return new Map(ids.map((id) => [id, terminal ? 'published' : 'sending']))
        },
        cleanup: async () => {
          state.cleaned = true
        },
      },
    }
  }

  it('fails closed without a reply-publication seam (capability darkness)', async () => {
    const vt = virtualTime()
    const env = fakeEnv({ vt })
    await expect(SCENARIO_EXECUTORS.replyBurst!(env, { burstSize: 5 })).rejects.toThrow(
      /reply publication/i,
    )
  })

  it('measures publish→terminal latency for a human-use burst', async () => {
    const vt = virtualTime()
    const { seam, published } = fakeReplySeam({ terminalAtPoll: 3 })
    let cleaned = false
    const seamTracked: NonNullable<ScenarioRunEnv['replyPublication']> = {
      ...seam,
      cleanup: async () => {
        cleaned = true
      },
    }
    const env = fakeEnv({ vt, replyPublication: seamTracked })
    const outcome = await SCENARIO_EXECUTORS.replyBurst!(env, {
      burstSize: 5,
      pollIntervalMs: 500,
      timeoutS: 60,
    })
    const { record, raw } = outcome
    expect(record.scenario).toBe('replyBurst')
    expect(record.passed).toBe(true)
    expect(published).toHaveLength(5)
    const terminalSamples = raw.samples.filter((s) => s.name === 'publish-terminal')
    expect(terminalSamples).toHaveLength(5)
    expect(Number(record.metrics.publishP95)).toBeLessThanOrEqual(
      SLOS.replyPublishTerminalP95,
    )
    expect(record.assertions.map((a) => a.check)).toEqual([
      'required_samples',
      'enqueue_error_free',
      'all_terminal',
      'publish_terminal_p95_within_slo',
      'monitoring_captured',
    ])
    expect(record.metrics.published).toBe(5)
    // Publish jobs swept + synthetic probe state removed.
    expect(env.removedIds).toHaveLength(5)
    expect(cleaned).toBe(true)
  })

  it('honestly fails when publications never reach a terminal state', async () => {
    const vt = virtualTime()
    const { seam } = fakeReplySeam({ terminalAtPoll: null })
    const env = fakeEnv({ vt, replyPublication: seam })
    const outcome = await SCENARIO_EXECUTORS.replyBurst!(env, {
      burstSize: 3,
      pollIntervalMs: 200,
      timeoutS: 1,
    })
    const { record } = outcome
    expect(record.passed).toBe(false)
    expect(record.assertions.find((a) => a.check === 'all_terminal')?.passed).toBe(false)
  })
})

describe('external collectors (BQC-8.2)', () => {
  it('ticks alongside the monitoring capture and lands in the record + raw', async () => {
    const vt = virtualTime()
    let ticks = 0
    const collector = {
      name: 'redis-info' as const,
      tick: async () => {
        ticks += 1
      },
      stop: async () => ({
        collector: 'redis-info' as const,
        points: [
          {
            at: new Date(T0).toISOString(),
            usedMemoryBytes: 1,
            usedMemoryPeakBytes: 2,
            keyspaceHits: 3,
            keyspaceMisses: 4,
            instantaneousOpsPerSec: 5,
          },
        ],
        readErrors: [],
      }),
    }
    const env = fakeEnv({ vt, externalCollector: collector })
    const outcome = await SCENARIO_EXECUTORS.steady!(env, {
      ratePerSec: 100,
      durationS: 1,
      pollIntervalMs: 250,
    })
    expect(ticks).toBeGreaterThanOrEqual(2)
    expect(outcome.record.collectors).toEqual({
      redisInfo: 'redis-cli',
      dbCpuLocks: 'not-collected-in-this-environment',
    })
    expect(outcome.raw.monitoring.external?.points).toHaveLength(1)
  })

  it('records the gap explicitly when no collector is available', async () => {
    const vt = virtualTime()
    const env = fakeEnv({ vt })
    const outcome = await SCENARIO_EXECUTORS.steady!(env, {
      ratePerSec: 100,
      durationS: 1,
      pollIntervalMs: 250,
    })
    expect(outcome.record.collectors).toEqual({
      redisInfo: 'not-collected-in-this-environment',
      dbCpuLocks: 'not-collected-in-this-environment',
    })
    expect(outcome.raw.monitoring.external).toBeUndefined()
  })
})
