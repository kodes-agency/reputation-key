// BQC-8.1 — executable scenario runners: the runnable subset of the §9.2
// catalogue (steady, burst, dashboardMix, drain) plus the fault-executor
// registry 8.4/8.5 will populate.
//
// Executors are environment-agnostic: every seam is injected.
//   - enqueue/removeJobs: the REAL BullMQ producer seam in the CLI (createJobQueue
//     + catalogue jobEnqueueOptions, BQC-3 contract); fakes in unit tests.
//   - snapshotSource: viaContainer or viaHttp ops-snapshot capture.
//   - clock/now/sleep: real wall/monotonic clocks in the CLI; virtual in tests.
//   - arrivalJob: the job family + payload factory the arrival scenarios
//     enqueue (8.2 will point it at real seeded properties; the local proof
//     uses synthetic identifier-only payloads).
//
// Honesty contract:
//   - Monitoring ticks are driven by the executor's own (injected) pacing, so
//     a run on any clock still records a real time series.
//   - Every run cleans up EXACTLY the jobs it enqueued (tracked ids), pass or
//     fail — the harness never leaves synthetic work in a shared queue.
//   - A failed SLO produces a failing record, never a silently passing one.

import { randomUUID } from 'node:crypto'
import type { Clock } from '#/shared/domain/clock'
import { runProbes, summarizeSamples, type PerfSample } from '../perf'
import {
  createCapture,
  type OpsSnapshotSource,
  type SnapshotSeries,
} from '../ops-snapshot-capture'
import {
  SCENARIOS,
  SLOS,
  type FaultName,
  type ScenarioName,
  type ScenarioRunRecord,
} from './catalogue'

/** Everything an executor needs from its environment. */
export type ScenarioRunEnv = Readonly<{
  /** Enqueue one job through the producer seam. Throws on transport failure. */
  enqueue: (
    jobName: string,
    data: Record<string, unknown>,
    jobId: string,
  ) => Promise<void>
  /** Remove exactly these job ids (best-effort per id; missing ids are ok). */
  removeJobs: (jobIds: readonly string[]) => Promise<{ removed: number; missing: number }>
  /** Monitoring source (container or HTTP mode). */
  snapshotSource: OpsSnapshotSource
  /** The job family + payload factory the arrival scenarios inject. */
  arrivalJob: Readonly<{
    name: string
    data: (seq: number) => Record<string, unknown>
  }>
  /** Read-path probe for dashboardMix (absent → that scenario fails closed). */
  dashboardProbe?: () => Promise<void>
  clock: Clock
  /** Monotonic milliseconds (performance.now in the CLI). */
  now: () => number
  sleep: (ms: number) => Promise<void>
  /** Run identity captured into every record (release + policy versions). */
  identity: Readonly<{
    environment: string
    releaseSha: string
    versions: ScenarioRunRecord['versions']
  }>
}>

export type ScenarioRunOptions = Readonly<{
  durationS?: number
  ratePerSec?: number
  backlogSize?: number
  timeoutS?: number
  concurrency?: number
  pollIntervalMs?: number
}>

export type ScenarioRunOutcome = Readonly<{
  record: ScenarioRunRecord
  raw: Readonly<{
    samples: readonly PerfSample[]
    monitoring: SnapshotSeries
  }>
}>

export type ScenarioExecutor = (
  env: ScenarioRunEnv,
  options: ScenarioRunOptions,
) => Promise<ScenarioRunOutcome>

/** Pass tolerance for achieved-vs-target rate (timer/scheduling slop). */
const RATE_TOLERANCE = 0.8

type Assertion = { check: string; passed: boolean; detail?: string }

function buildRecord(
  env: ScenarioRunEnv,
  scenario: string,
  startedAt: string,
  durationMs: number,
  metrics: Record<string, number | string>,
  assertions: Assertion[],
  slo: Record<string, number | string | boolean>,
  samples: { count: number; errors: number },
  monitoring: { points: number; readErrors: number },
): ScenarioRunRecord {
  return {
    scenario,
    startedAt,
    durationMs,
    passed: assertions.every((a) => a.passed),
    metrics,
    assertions,
    environment: env.identity.environment,
    releaseSha: env.identity.releaseSha,
    versions: env.identity.versions,
    slo,
    samples,
    monitoring,
  }
}

// ── steady / burst: paced arrival injection ─────────────────────────

async function runArrival(
  kind: 'steady' | 'burst',
  env: ScenarioRunEnv,
  options: ScenarioRunOptions,
): Promise<ScenarioRunOutcome> {
  const catalogueSlo = SCENARIOS[kind].slo
  const rate = options.ratePerSec ?? catalogueSlo.rate
  const durationS = options.durationS ?? (kind === 'burst' ? SLOS.burstDuration : 30)
  const pollIntervalMs = options.pollIntervalMs ?? 1000
  const intervalMs = 1000 / rate
  const runId = randomUUID()
  const capture = createCapture({
    source: env.snapshotSource,
    intervalMs: pollIntervalMs,
    clock: env.clock,
  })

  const startedAt = env.clock().toISOString()
  const t0 = env.now()
  const deadline = t0 + durationS * 1000
  const samples: PerfSample[] = []
  const jobIds: string[] = []
  let seq = 0
  let nextAt = t0
  let nextTickAt = t0 + pollIntervalMs
  // Assigned in the finally below (which always runs) — read afterwards.
  let cleanup: { removed: number; missing: number }

  try {
    while (env.now() < deadline) {
      const jobId = `perf-${kind}-${runId}-${seq}`
      const s0 = env.now()
      const sampleStartedAt = env.clock().toISOString()
      let ok = true
      try {
        await env.enqueue(env.arrivalJob.name, env.arrivalJob.data(seq), jobId)
        jobIds.push(jobId)
      } catch {
        ok = false
      }
      samples.push({
        name: 'enqueue',
        startedAt: sampleStartedAt,
        durationMs: env.now() - s0,
        ok,
      })
      seq += 1
      // Monitoring ticks on the run's own pacing (virtual-clock friendly).
      while (env.now() >= nextTickAt) {
        await capture.tick()
        nextTickAt += pollIntervalMs
      }
      nextAt += intervalMs
      const wait = nextAt - env.now()
      if (wait > 0) await env.sleep(wait)
    }
    // Final tick: the end state is part of the measurement.
    await capture.tick()
  } finally {
    // Leave the environment as found: remove exactly this run's jobs.
    cleanup = await env.removeJobs(jobIds)
  }

  const elapsedMs = env.now() - t0
  const series = await capture.stop()
  const summary = summarizeSamples(samples, elapsedMs)
  const achievedRatePerSec = samples.length / (elapsedMs / 1000)

  const assertions: Assertion[] = [
    {
      check: 'required_samples',
      passed: samples.length > 0,
      detail: `${samples.length} samples collected`,
    },
    {
      check: 'enqueue_error_free',
      passed: summary.errors === 0,
      detail: `${summary.errors} enqueue failures`,
    },
    {
      check: 'rate_achieved',
      passed: achievedRatePerSec >= rate * RATE_TOLERANCE,
      detail: `achieved ${achievedRatePerSec.toFixed(1)}/s vs target ${rate}/s`,
    },
    {
      check: 'monitoring_captured',
      passed: series.points.length > 0,
      detail: `${series.points.length} points, ${series.readErrors.length} read errors`,
    },
  ]
  if (kind === 'burst') {
    const uniqueIds = new Set(jobIds).size
    assertions.push({
      check: 'no_duplicates',
      passed:
        uniqueIds === jobIds.length && jobIds.length === summary.count - summary.errors,
      detail: `${uniqueIds} unique ids over ${jobIds.length} accepted enqueues`,
    })
  }

  const metrics: Record<string, number | string> = {
    targetRatePerSec: rate,
    achievedRatePerSec: Number(achievedRatePerSec.toFixed(2)),
    executedDurationS: Number((elapsedMs / 1000).toFixed(3)),
    enqueued: jobIds.length,
    enqueueErrors: summary.errors,
    enqueueP50: Number(summary.p50.toFixed(2)),
    enqueueP95: Number(summary.p95.toFixed(2)),
    enqueueP99: Number(summary.p99.toFixed(2)),
    removedOnCleanup: cleanup.removed,
    cleanupMissed: cleanup.missing,
  }

  return {
    record: buildRecord(
      env,
      kind,
      startedAt,
      elapsedMs,
      metrics,
      assertions,
      { ...catalogueSlo },
      { count: samples.length, errors: summary.errors },
      { points: series.points.length, readErrors: series.readErrors.length },
    ),
    raw: { samples, monitoring: series },
  }
}

// ── dashboardMix: concurrent read probes against the real read path ──

async function runDashboardMix(
  env: ScenarioRunEnv,
  options: ScenarioRunOptions,
): Promise<ScenarioRunOutcome> {
  const probe = env.dashboardProbe
  if (!probe) {
    throw new Error(
      'dashboardMix requires a dashboard probe (container mode with a seeded property); none was provided',
    )
  }
  const catalogueSlo = SCENARIOS.dashboardMix.slo
  const durationS = options.durationS ?? 15
  const concurrency = options.concurrency ?? 4
  const pollIntervalMs = options.pollIntervalMs ?? 1000
  const capture = createCapture({
    source: env.snapshotSource,
    intervalMs: pollIntervalMs,
    clock: env.clock,
  })

  const startedAt = env.clock().toISOString()
  const t0 = env.now()
  // Monitoring ticks run alongside the probe pool on the same injected clock.
  let probing = true
  const ticker = (async () => {
    while (probing) {
      await env.sleep(pollIntervalMs)
      await capture.tick()
    }
  })()
  const samples = await runProbes({
    name: 'dashboard-read',
    durationMs: durationS * 1000,
    concurrency,
    probe: async () => {
      await probe()
    },
    clock: env.clock,
    now: env.now,
    sleep: env.sleep,
  })
  probing = false
  await ticker
  await capture.tick()

  const elapsedMs = env.now() - t0
  const series = await capture.stop()
  const summary = summarizeSamples(samples, elapsedMs)
  const warmP95 = summary.p95

  const assertions: Assertion[] = [
    {
      check: 'required_samples',
      passed: samples.length > 0,
      detail: `${samples.length} samples collected`,
    },
    {
      check: 'probe_error_free',
      passed: summary.errors === 0,
      detail: `${summary.errors} read failures`,
    },
    {
      check: 'warm_p95_within_budget',
      passed: warmP95 <= SLOS.dashboardP95,
      detail: `p95 ${warmP95.toFixed(1)}ms vs budget ${SLOS.dashboardP95}ms`,
    },
    {
      check: 'monitoring_captured',
      passed: series.points.length > 0,
      detail: `${series.points.length} points, ${series.readErrors.length} read errors`,
    },
  ]

  const metrics: Record<string, number | string> = {
    reads: summary.count,
    readErrors: summary.errors,
    readP50: Number(summary.p50.toFixed(2)),
    readP95: Number(warmP95.toFixed(2)),
    readP99: Number(summary.p99.toFixed(2)),
    readRatePerSec: Number(summary.ratePerSec.toFixed(2)),
    concurrency,
    executedDurationS: Number((elapsedMs / 1000).toFixed(3)),
  }

  return {
    record: buildRecord(
      env,
      'dashboardMix',
      startedAt,
      elapsedMs,
      metrics,
      assertions,
      { ...catalogueSlo },
      { count: samples.length, errors: summary.errors },
      { points: series.points.length, readErrors: series.readErrors.length },
    ),
    raw: { samples, monitoring: series },
  }
}

// ── drain: backlog injection then time-to-empty measurement ─────────

async function runDrain(
  env: ScenarioRunEnv,
  options: ScenarioRunOptions,
): Promise<ScenarioRunOutcome> {
  const catalogueSlo = SCENARIOS.drain.slo
  const backlog = options.backlogSize ?? 100
  const timeoutS = options.timeoutS ?? SLOS.drainTimeout
  const pollIntervalMs = options.pollIntervalMs ?? 1000
  const runId = randomUUID()
  const capture = createCapture({
    source: env.snapshotSource,
    intervalMs: pollIntervalMs,
    clock: env.clock,
  })

  const startedAt = env.clock().toISOString()
  const t0 = env.now()
  const jobIds: string[] = []
  let drainedMs: number | null = null
  let remainingWaiting = backlog
  // Both assigned in the try/finally below — the finally always runs.
  let injectSamples: readonly PerfSample[]
  let cleanup: { removed: number; missing: number }

  try {
    // Phase 1: inject the backlog as fast as the seam accepts it.
    injectSamples = await runProbes({
      name: 'inject',
      count: backlog,
      concurrency: 8,
      probe: async (i) => {
        const jobId = `perf-drain-${runId}-${i}`
        await env.enqueue(env.arrivalJob.name, env.arrivalJob.data(i), jobId)
        jobIds.push(jobId)
      },
      clock: env.clock,
      now: env.now,
      sleep: env.sleep,
    })

    // Phase 2: poll the monitored queue depth until empty or the deadline.
    const injectEndMs = env.now()
    const drainDeadline = env.now() + timeoutS * 1000
    while (env.now() < drainDeadline) {
      const point = await capture.tick()
      const waiting = point?.queues.find((q) => q.name === 'default')?.waiting
      if (waiting != null) remainingWaiting = waiting
      if (remainingWaiting === 0) {
        drainedMs = env.now() - injectEndMs
        break
      }
      await env.sleep(pollIntervalMs)
    }
  } finally {
    // Sweep exactly the injected jobs, drained or not — a failed measurement
    // must not leak synthetic work into a shared queue.
    cleanup = await env.removeJobs(jobIds)
  }

  const elapsedMs = env.now() - t0
  const series = await capture.stop()
  const injectSummary = summarizeSamples(injectSamples, Math.max(1, elapsedMs))

  const assertions: Assertion[] = [
    {
      check: 'required_samples',
      passed: injectSamples.length > 0,
      detail: `${injectSamples.length} injection samples`,
    },
    {
      check: 'injection_error_free',
      passed: injectSummary.errors === 0,
      detail: `${injectSummary.errors} injection failures`,
    },
    {
      check: 'drained_within_timeout',
      passed: drainedMs != null,
      detail:
        drainedMs != null
          ? `drained ${backlog} jobs in ${(drainedMs / 1000).toFixed(1)}s (timeout ${timeoutS}s)`
          : `${remainingWaiting} jobs still waiting after ${timeoutS}s`,
    },
    {
      check: 'monitoring_captured',
      passed: series.points.length > 0,
      detail: `${series.points.length} points, ${series.readErrors.length} read errors`,
    },
  ]

  const metrics: Record<string, number | string> = {
    backlogSize: backlog,
    injected: jobIds.length,
    injectionRatePerSec: Number(injectSummary.ratePerSec.toFixed(2)),
    remainingWaiting,
    removedOnCleanup: cleanup.removed,
    cleanupMissed: cleanup.missing,
    ...(drainedMs != null ? { drainMs: Number(drainedMs.toFixed(1)) } : {}),
  }

  return {
    record: buildRecord(
      env,
      'drain',
      startedAt,
      elapsedMs,
      metrics,
      assertions,
      { ...catalogueSlo },
      { count: injectSamples.length, errors: injectSummary.errors },
      { points: series.points.length, readErrors: series.readErrors.length },
    ),
    raw: { samples: injectSamples, monitoring: series },
  }
}

// ── Registries ──────────────────────────────────────────────────────

/**
 * The executable subset. Catalogue scenarios without an executor resolve to
 * undefined — the CLI fails closed on them (never prints the catalogue as if
 * it were an execution). Later slices register more executors HERE.
 */
export const SCENARIO_EXECUTORS: Partial<Record<ScenarioName, ScenarioExecutor>> = {
  steady: (env, options) => runArrival('steady', env, options),
  burst: (env, options) => runArrival('burst', env, options),
  dashboardMix: runDashboardMix,
  drain: runDrain,
}

/**
 * Fault-executor registry — EMPTY in this slice. BQC-8.4 (runtime fault
 * matrix) and BQC-8.5 (region fault matrix) register real fault executors
 * here; the CLI dispatches by catalogue name and fails closed until then.
 */
export const FAULT_EXECUTORS: Partial<Record<FaultName, ScenarioExecutor>> = {}

export function getScenarioExecutor(name: string): ScenarioExecutor | undefined {
  return SCENARIO_EXECUTORS[name as ScenarioName]
}

export function getFaultExecutor(name: string): ScenarioExecutor | undefined {
  return FAULT_EXECUTORS[name as FaultName]
}
