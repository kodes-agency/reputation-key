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
  type CaptureResult,
  type OpsSnapshotSource,
} from '../ops-snapshot-capture'
import type { ExternalCollector } from '../external-collectors'
import {
  SCENARIOS,
  SLOS,
  type CollectorCoverage,
  type FaultName,
  type ScenarioName,
  type ScenarioRunRecord,
} from './catalogue'

export type RetentionRunSummary = Readonly<{
  expiredBefore: number
  purged: number
  expiredAfter: number
  batches: number
  canariesChecked: number
  canariesRemaining: number
  bounded: boolean
}>

export type FaultAssertion = Readonly<{
  check: string
  passed: boolean
  detail?: string
}>

export type FaultRunSummary = Readonly<{
  fault: FaultName
  injected: boolean
  recovered: boolean
  assertions: readonly FaultAssertion[]
  metrics: Readonly<Record<string, number | string>>
}>

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
  /**
   * BQC-8.2 singlePropertyBurst: the hot-property job family + payload
   * factory. Absent → that scenario fails closed.
   */
  hotArrivalJob?: Readonly<{
    name: string
    data: (seq: number) => Record<string, unknown>
  }>
  /** Read-path probe for dashboardMix/dashboardCold (absent → fail closed). */
  dashboardProbe?: () => Promise<void>
  /**
   * BQC-8.2 dashboardCold: restart whatever serves the read path (fresh
   * process/container → cold caches). Absent → that scenario fails closed.
   */
  restartReadPath?: () => Promise<void>
  /**
   * BQC-8.2 replyBurst: the real reply-publication path. Absent when the
   * environment cannot run it honestly (capability darkness) → the scenario
   * fails closed and the row stays not-executed — never faked.
   */
  replyPublication?: Readonly<{
    /** Create `count` claimable replies (+ provider/connection state); ids back. */
    prepare: (count: number) => Promise<readonly string[]>
    /** Enqueue the publish job for one reply (publish-reply contract). */
    enqueuePublish: (replyId: string, jobId: string) => Promise<void>
    /** Current publication_state per reply id. */
    publicationStates: (
      replyIds: readonly string[],
    ) => Promise<ReadonlyMap<string, string>>
    /** Remove exactly the synthetic probe state (replies/reviews/connection). */
    cleanup: () => Promise<void>
  }>
  /**
   * BQC-8.3: one real lifecycle sweep over the seeded target dataset.
   * The CLI wires this to the production purge job and content-copy probes;
   * absent means retention evidence is invalid rather than simulated.
   */
  lifecycle?: Readonly<{
    runRetention: () => Promise<RetentionRunSummary>
  }>
  /**
   * BQC-8.4/8.5 controlled fault surface. The controller performs the real
   * process/network/provider action and returns content-free observations;
   * without it the executor produces a failing, non-evidence record.
   */
  faults?: Readonly<{
    execute: (fault: FaultName) => Promise<FaultRunSummary>
  }>
  /**
   * BQC-8.2: optional platform-side collector (redis-cli INFO). Ticked with
   * the monitoring capture; its coverage lands in the record's collectors
   * section — absent → the record states the gap explicitly.
   */
  externalCollector?: ExternalCollector
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
  /** BQC-8.2: fleetDispatch target count (default SLOS.fleetProperties). */
  fleetSize?: number
  /** BQC-8.2: hot-property burst rate (singlePropertyBurst / reconnect catch-up). */
  hotRatePerSec?: number
  /** BQC-8.2: reconnect simulated-outage window (default SLOS.reconnectOutage). */
  outageS?: number
  /** BQC-8.2: reconnect baseline arrival window before the outage. */
  baselineS?: number
  /** BQC-8.2: dashboardCold first-read count (default catalogue firstReads). */
  reads?: number
  /** BQC-8.2: replyBurst publication count (default SLOS.replyBurstSize). */
  burstSize?: number
}>

export type ScenarioRunOutcome = Readonly<{
  record: ScenarioRunRecord
  raw: Readonly<{
    samples: readonly PerfSample[]
    monitoring: CaptureResult
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
    collectors: collectorCoverage(env),
  }
}

/** The record's external-coverage statement — explicit, never a silent gap. */
function collectorCoverage(env: ScenarioRunEnv): CollectorCoverage {
  return {
    redisInfo: env.externalCollector ? 'redis-cli' : 'not-collected-in-this-environment',
    // DB CPU/locks are not app-readable and have no local CLI surface —
    // platform observability is the acceptance surface (docs/performance/
    // scale-harness.md). Stated here so the gap is never silent.
    dbCpuLocks: 'not-collected-in-this-environment',
  }
}

/** Monitoring capture with the run's collector wired in (when present). */
function startCapture(
  env: ScenarioRunEnv,
  pollIntervalMs: number,
): ReturnType<typeof createCapture> {
  return createCapture({
    source: env.snapshotSource,
    intervalMs: pollIntervalMs,
    clock: env.clock,
    external: env.externalCollector,
  })
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
  const capture = startCapture(env, pollIntervalMs)

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
  const capture = startCapture(env, pollIntervalMs)

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
  const capture = startCapture(env, pollIntervalMs)

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

// ── BQC-8.2: singlePropertyBurst — hot tenant + background fairness ───

async function runSinglePropertyBurst(
  env: ScenarioRunEnv,
  options: ScenarioRunOptions,
): Promise<ScenarioRunOutcome> {
  const hotJob = env.hotArrivalJob
  if (!hotJob) {
    throw new Error(
      'singlePropertyBurst requires a hot-property job seam (hotArrivalJob); none was provided',
    )
  }
  const catalogueSlo = SCENARIOS.singlePropertyBurst.slo
  const rate = options.ratePerSec ?? catalogueSlo.backgroundRate
  const hotRate = options.hotRatePerSec ?? catalogueSlo.hotRate
  const durationS = options.durationS ?? catalogueSlo.duration
  const pollIntervalMs = options.pollIntervalMs ?? 1000
  const runId = randomUUID()
  const capture = startCapture(env, pollIntervalMs)

  const startedAt = env.clock().toISOString()
  const t0 = env.now()
  const deadline = t0 + durationS * 1000
  const samples: PerfSample[] = []
  const jobIds: string[] = []
  let bgSeq = 0
  let hotSeq = 0
  let nextBgAt = t0
  let nextHotAt = t0
  let nextTickAt = t0 + pollIntervalMs
  const bgIntervalMs = 1000 / rate
  const hotIntervalMs = 1000 / hotRate
  let cleanup: { removed: number; missing: number }

  const inject = async (stream: 'bg' | 'hot', seq: number): Promise<void> => {
    const jobId = `perf-spb-${stream}-${runId}-${seq}`
    const s0 = env.now()
    const sampleStartedAt = env.clock().toISOString()
    let ok = true
    try {
      const job = stream === 'bg' ? env.arrivalJob : hotJob
      await env.enqueue(job.name, job.data(seq), jobId)
      jobIds.push(jobId)
    } catch {
      ok = false
    }
    samples.push({
      name: stream === 'bg' ? 'enqueue-background' : 'enqueue-hot',
      startedAt: sampleStartedAt,
      durationMs: env.now() - s0,
      ok,
    })
  }

  try {
    while (env.now() < deadline) {
      // Dispatch whichever stream is due (ties: background first).
      if (nextBgAt <= env.now() && nextBgAt <= nextHotAt) {
        await inject('bg', bgSeq)
        bgSeq += 1
        nextBgAt += bgIntervalMs
      } else if (nextHotAt <= env.now()) {
        await inject('hot', hotSeq)
        hotSeq += 1
        nextHotAt += hotIntervalMs
      }
      while (env.now() >= nextTickAt) {
        await capture.tick()
        nextTickAt += pollIntervalMs
      }
      const wait = Math.min(nextBgAt, nextHotAt, nextTickAt) - env.now()
      if (wait > 0) await env.sleep(wait)
    }
    await capture.tick()
  } finally {
    cleanup = await env.removeJobs(jobIds)
  }

  const elapsedMs = env.now() - t0
  const series = await capture.stop()
  const bgSamples = samples.filter((s) => s.name === 'enqueue-background')
  const hotSamples = samples.filter((s) => s.name === 'enqueue-hot')
  const bgSummary = summarizeSamples(bgSamples, elapsedMs)
  const hotSummary = summarizeSamples(hotSamples, elapsedMs)
  const bgAchieved = bgSamples.length / (elapsedMs / 1000)
  const hotAchieved = hotSamples.length / (elapsedMs / 1000)
  // Tenant fairness: the default queue's waiting depth stayed bounded while
  // the hot property burst (other tenants' work never piled up past the SLO).
  const maxQueueWaiting = series.points.reduce(
    (max, p) => Math.max(max, p.queues.find((q) => q.name === 'default')?.waiting ?? 0),
    0,
  )

  const assertions: Assertion[] = [
    {
      check: 'required_samples',
      passed: samples.length > 0,
      detail: `${samples.length} samples (${bgSamples.length} background, ${hotSamples.length} hot)`,
    },
    {
      check: 'hot_samples_land',
      passed: hotSamples.length > 0 && hotSummary.errors === 0,
      detail: `${hotSamples.length} hot samples, ${hotSummary.errors} errors`,
    },
    {
      check: 'background_error_free',
      passed: bgSummary.errors === 0,
      detail: `${bgSummary.errors} background enqueue failures`,
    },
    {
      check: 'background_rate_no_starvation',
      passed: bgAchieved >= rate * SLOS.backgroundRateFloor,
      detail: `background achieved ${bgAchieved.toFixed(1)}/s vs floor ${(rate * SLOS.backgroundRateFloor).toFixed(1)}/s (target ${rate}/s)`,
    },
    {
      check: 'queue_depth_bounded',
      passed: maxQueueWaiting <= SLOS.maxQueueDepth,
      detail: `max waiting ${maxQueueWaiting} vs bound ${SLOS.maxQueueDepth}`,
    },
    {
      check: 'monitoring_captured',
      passed: series.points.length > 0,
      detail: `${series.points.length} points, ${series.readErrors.length} read errors`,
    },
  ]

  const metrics: Record<string, number | string> = {
    backgroundTargetRatePerSec: rate,
    backgroundAchievedRatePerSec: Number(bgAchieved.toFixed(2)),
    hotTargetRatePerSec: hotRate,
    hotAchievedRatePerSec: Number(hotAchieved.toFixed(2)),
    backgroundEnqueued: bgSamples.length,
    hotEnqueued: hotSamples.length,
    enqueueP95: Number(summarizeSamples(samples, elapsedMs).p95.toFixed(2)),
    maxQueueWaiting,
    executedDurationS: Number((elapsedMs / 1000).toFixed(3)),
    removedOnCleanup: cleanup.removed,
    cleanupMissed: cleanup.missing,
  }

  return {
    record: buildRecord(
      env,
      'singlePropertyBurst',
      startedAt,
      elapsedMs,
      metrics,
      assertions,
      { ...catalogueSlo },
      { count: samples.length, errors: bgSummary.errors + hotSummary.errors },
      { points: series.points.length, readErrors: series.readErrors.length },
    ),
    raw: { samples, monitoring: series },
  }
}

// ── BQC-8.2: reconnect — outage window, catch-up burst, drain ────────

async function runReconnect(
  env: ScenarioRunEnv,
  options: ScenarioRunOptions,
): Promise<ScenarioRunOutcome> {
  const catalogueSlo = SCENARIOS.reconnect.slo
  const rate = options.ratePerSec ?? SLOS.steadyReviewRate
  const baselineS = options.baselineS ?? 30
  const outageS = options.outageS ?? catalogueSlo.outageDuration
  const catchUpRate = options.hotRatePerSec ?? catalogueSlo.catchUpRate
  const timeoutS = options.timeoutS ?? catalogueSlo.drainTimeout
  const pollIntervalMs = options.pollIntervalMs ?? 1000
  const runId = randomUUID()
  const capture = startCapture(env, pollIntervalMs)

  const startedAt = env.clock().toISOString()
  const t0 = env.now()
  const samples: PerfSample[] = []
  const jobIds: string[] = []
  let seq = 0
  let cleanup: { removed: number; missing: number }
  let catchUpDrainMs: number | null = null
  let remainingWaiting = -1

  const marker = (): void => {
    samples.push({
      name: 'outage-window',
      startedAt: env.clock().toISOString(),
      durationMs: 0,
      ok: true,
    })
  }

  /** Pace `count` (or to `deadline`) arrival enqueues at `paceRate`. */
  const pace = async (
    paceRate: number,
    sampleName: string,
    deadline: number,
  ): Promise<void> => {
    const intervalMs = 1000 / paceRate
    let nextAt = env.now()
    let nextTickAt = env.now() + pollIntervalMs
    while (env.now() < deadline) {
      const jobId = `perf-reconnect-${runId}-${seq}`
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
        name: sampleName,
        startedAt: sampleStartedAt,
        durationMs: env.now() - s0,
        ok,
      })
      seq += 1
      while (env.now() >= nextTickAt) {
        await capture.tick()
        nextTickAt += pollIntervalMs
      }
      nextAt += intervalMs
      const wait = nextAt - env.now()
      if (wait > 0) await env.sleep(wait)
    }
  }

  try {
    // Phase 1: baseline arrival.
    await pace(rate, 'enqueue-baseline', t0 + baselineS * 1000)

    // Phase 2: provider outage — injection pauses (marker), worker keeps
    // draining; monitoring continues on the run's own pacing.
    marker()
    const outageEnd = env.now() + outageS * 1000
    while (env.now() < outageEnd) {
      await capture.tick()
      const wait = Math.min(pollIntervalMs, outageEnd - env.now())
      if (wait > 0) await env.sleep(wait)
    }
    marker()

    // Phase 3: reconnect catch-up — the arrivals missed during the outage
    // land as a burst at the catch-up rate.
    const missed = Math.round(rate * outageS)
    const catchUpStart = env.now()
    await pace(
      catchUpRate,
      'enqueue-catchup',
      catchUpStart + (missed / catchUpRate) * 1000,
    )
    const catchUpEnd = env.now()

    // Phase 4: drain — poll the monitored queue depth until empty/deadline.
    const drainDeadline = env.now() + timeoutS * 1000
    while (env.now() < drainDeadline) {
      const point = await capture.tick()
      const waiting = point?.queues.find((q) => q.name === 'default')?.waiting
      if (waiting != null) remainingWaiting = waiting
      if (remainingWaiting === 0) {
        catchUpDrainMs = env.now() - catchUpEnd
        break
      }
      await env.sleep(pollIntervalMs)
    }
  } finally {
    cleanup = await env.removeJobs(jobIds)
  }

  const elapsedMs = env.now() - t0
  const series = await capture.stop()
  const baseline = samples.filter((s) => s.name === 'enqueue-baseline')
  const catchup = samples.filter((s) => s.name === 'enqueue-catchup')
  const baselineSummary = summarizeSamples(baseline, Math.max(1, baselineS * 1000))
  const catchupSummary = summarizeSamples(catchup, Math.max(1, elapsedMs))
  const uniqueIds = new Set(jobIds).size
  const accepted =
    baseline.length - baselineSummary.errors + (catchup.length - catchupSummary.errors)

  const assertions: Assertion[] = [
    {
      check: 'required_samples',
      passed: baseline.length + catchup.length > 0,
      detail: `${baseline.length} baseline + ${catchup.length} catch-up samples`,
    },
    {
      check: 'baseline_error_free',
      passed: baselineSummary.errors === 0,
      detail: `${baselineSummary.errors} baseline enqueue failures`,
    },
    {
      check: 'catchup_error_free',
      passed: catchupSummary.errors === 0,
      detail: `${catchupSummary.errors} catch-up enqueue failures`,
    },
    {
      check: 'no_duplicates',
      passed: uniqueIds === jobIds.length,
      detail: `${uniqueIds} unique ids over ${jobIds.length} enqueues`,
    },
    {
      check: 'no_loss',
      passed: accepted === jobIds.length && remainingWaiting === 0,
      detail: `${accepted} accepted of ${jobIds.length} tracked; ${remainingWaiting} waiting at end (consumed or swept, never stranded)`,
    },
    {
      check: 'catchup_drained_within_slo',
      passed: catchUpDrainMs != null,
      detail:
        catchUpDrainMs != null
          ? `catch-up backlog drained in ${(catchUpDrainMs / 1000).toFixed(1)}s (timeout ${timeoutS}s)`
          : `${remainingWaiting} jobs still waiting after ${timeoutS}s`,
    },
    {
      check: 'monitoring_captured',
      passed: series.points.length > 0,
      detail: `${series.points.length} points, ${series.readErrors.length} read errors`,
    },
  ]

  const metrics: Record<string, number | string> = {
    baselineEnqueued: baseline.length,
    outageDurationS: outageS,
    catchUpEnqueued: catchup.length,
    catchUpRatePerSec: Number(catchupSummary.ratePerSec.toFixed(2)),
    remainingWaiting,
    removedOnCleanup: cleanup.removed,
    cleanupMissed: cleanup.missing,
    executedDurationS: Number((elapsedMs / 1000).toFixed(3)),
    ...(catchUpDrainMs != null
      ? { catchUpDrainMs: Number(catchUpDrainMs.toFixed(1)) }
      : {}),
  }

  return {
    record: buildRecord(
      env,
      'reconnect',
      startedAt,
      elapsedMs,
      metrics,
      assertions,
      { ...catalogueSlo },
      {
        count: baseline.length + catchup.length,
        errors: baselineSummary.errors + catchupSummary.errors,
      },
      { points: series.points.length, readErrors: series.readErrors.length },
    ),
    raw: { samples, monitoring: series },
  }
}

// ── BQC-8.2: fleetDispatch — whole-fleet dispatch rate + projection ──

async function runFleetDispatch(
  env: ScenarioRunEnv,
  options: ScenarioRunOptions,
): Promise<ScenarioRunOutcome> {
  const catalogueSlo = SCENARIOS.fleetDispatch.slo
  const fleetSize = options.fleetSize ?? SLOS.fleetProperties
  const pollIntervalMs = options.pollIntervalMs ?? 1000
  const runId = randomUUID()
  const capture = startCapture(env, pollIntervalMs)

  const startedAt = env.clock().toISOString()
  const t0 = env.now()
  const jobIds: string[] = []
  let cleanup: { removed: number; missing: number }
  let dispatchSamples: readonly PerfSample[]
  let dispatchWindowMs: number

  try {
    // Monitoring ticks alongside dispatch on the run's own pacing.
    let dispatching = true
    const ticker = (async () => {
      while (dispatching) {
        await env.sleep(pollIntervalMs)
        await capture.tick()
      }
    })()

    // Dispatch one refresh job per fleet target as fast as the seam accepts.
    const dispatchStartMs = env.now()
    dispatchSamples = await runProbes({
      name: 'dispatch',
      count: fleetSize,
      concurrency: options.concurrency ?? 8,
      probe: async (i) => {
        const jobId = `perf-fleet-${runId}-${i}`
        await env.enqueue(env.arrivalJob.name, env.arrivalJob.data(i), jobId)
        jobIds.push(jobId)
      },
      clock: env.clock,
      now: env.now,
      sleep: env.sleep,
    })
    dispatchWindowMs = Math.max(1, env.now() - dispatchStartMs)
    dispatching = false
    await ticker

    // Backlog shape: a short post-dispatch watch window (3 ticks).
    for (let i = 0; i < 3; i++) {
      await env.sleep(pollIntervalMs)
      await capture.tick()
    }
  } finally {
    cleanup = await env.removeJobs(jobIds)
  }

  const elapsedMs = env.now() - t0
  const series = await capture.stop()
  const summary = summarizeSamples(dispatchSamples, elapsedMs)
  const dispatchRate = dispatchSamples.length / (dispatchWindowMs / 1000)
  // PROJECTION (never presented as measured): the catalogue fleet over the
  // measured dispatch rate vs the 4h wall-clock window.
  const projectedWindowS = SLOS.fleetProperties / dispatchRate
  const fleetWindowS = SLOS.fleetWindow * 3600
  const projectedOk = projectedWindowS <= fleetWindowS

  const assertions: Assertion[] = [
    {
      check: 'required_samples',
      passed: dispatchSamples.length === fleetSize,
      detail: `${dispatchSamples.length}/${fleetSize} dispatch samples`,
    },
    {
      check: 'dispatch_error_free',
      passed: summary.errors === 0,
      detail: `${summary.errors} dispatch failures`,
    },
    {
      check: 'projected_window_within_slo',
      passed: projectedOk,
      detail: `PROJECTION: ${SLOS.fleetProperties} targets at measured ${dispatchRate.toFixed(1)}/s → ${(projectedWindowS / 3600).toFixed(2)}h vs ${SLOS.fleetWindow}h window (projection from the measured dispatch rate, not a measured wall-clock window)`,
    },
    {
      check: 'monitoring_captured',
      passed: series.points.length > 0,
      detail: `${series.points.length} points, ${series.readErrors.length} read errors`,
    },
  ]

  const metrics: Record<string, number | string> = {
    fleetTargets: fleetSize,
    dispatched: jobIds.length,
    dispatchRatePerSec: Number(dispatchRate.toFixed(2)),
    projectedWindowS: Number(projectedWindowS.toFixed(1)),
    projection: `projection — dispatch-rate extrapolation over ${SLOS.fleetProperties} catalogue targets, not a measured ${SLOS.fleetWindow}h window`,
    projectedWithinWindow: projectedOk ? 'yes' : 'no',
    removedOnCleanup: cleanup.removed,
    cleanupMissed: cleanup.missing,
    executedDurationS: Number((elapsedMs / 1000).toFixed(3)),
  }

  return {
    record: buildRecord(
      env,
      'fleetDispatch',
      startedAt,
      elapsedMs,
      metrics,
      assertions,
      { ...catalogueSlo },
      { count: dispatchSamples.length, errors: summary.errors },
      { points: series.points.length, readErrors: series.readErrors.length },
    ),
    raw: { samples: dispatchSamples, monitoring: series },
  }
}

// ── BQC-8.2: dashboardCold — first reads through a fresh read path ───

async function runDashboardCold(
  env: ScenarioRunEnv,
  options: ScenarioRunOptions,
): Promise<ScenarioRunOutcome> {
  const probe = env.dashboardProbe
  if (!probe) {
    throw new Error(
      'dashboardCold requires a dashboard probe (container mode with a seeded property); none was provided',
    )
  }
  if (!env.restartReadPath) {
    throw new Error(
      'dashboardCold requires a read-path restart seam (restartReadPath); none was provided',
    )
  }
  const catalogueSlo = SCENARIOS.dashboardCold.slo
  const reads = options.reads ?? catalogueSlo.firstReads
  const pollIntervalMs = options.pollIntervalMs ?? 1000
  const capture = startCapture(env, pollIntervalMs)

  const startedAt = env.clock().toISOString()
  const t0 = env.now()
  await capture.tick()
  // Cold start: restart the read path, then measure the FIRST reads through
  // it — the cold-cache population cost is in the samples, by construction.
  await env.restartReadPath()
  const samples = await runProbes({
    name: 'dashboard-cold-read',
    count: reads,
    concurrency: 1, // first reads are sequential — no warm-up overlap
    probe: async () => {
      await probe()
    },
    clock: env.clock,
    now: env.now,
    sleep: env.sleep,
  })
  await capture.tick()

  const elapsedMs = env.now() - t0
  const series = await capture.stop()
  const summary = summarizeSamples(samples, elapsedMs)
  const coldP95 = summary.p95

  const assertions: Assertion[] = [
    {
      check: 'required_samples',
      passed: samples.length === reads,
      detail: `${samples.length}/${reads} cold-read samples`,
    },
    {
      check: 'probe_error_free',
      passed: summary.errors === 0,
      detail: `${summary.errors} read failures`,
    },
    {
      check: 'cold_p95_within_budget',
      passed: coldP95 <= SLOS.dashboardColdP95,
      detail: `p95 ${coldP95.toFixed(1)}ms vs cold budget ${SLOS.dashboardColdP95}ms`,
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
    readP95: Number(coldP95.toFixed(2)),
    readP99: Number(summary.p99.toFixed(2)),
    coldBasis:
      'fresh read-path process/container — first-N reads before any cache warm-up (cache cold start)',
    executedDurationS: Number((elapsedMs / 1000).toFixed(3)),
  }

  return {
    record: buildRecord(
      env,
      'dashboardCold',
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

// ── BQC-8.2: replyBurst — human-use publication burst, publish→terminal ──

/** Human pacing for a publication burst (an operator clicking publish). */
const REPLY_BURST_PACE_PER_SEC = 5
/** publication_state values the saga considers final for this measurement. */
const TERMINAL_PUBLICATION_STATES = new Set([
  'published',
  'terminal',
  'ambiguous',
  'cancelled',
])

async function runReplyBurst(
  env: ScenarioRunEnv,
  options: ScenarioRunOptions,
): Promise<ScenarioRunOutcome> {
  const seam = env.replyPublication
  if (!seam) {
    throw new Error(
      'replyBurst requires the reply publication seam (capability-dark environments leave this scenario not-executed); none was provided',
    )
  }
  const catalogueSlo = SCENARIOS.replyBurst.slo
  const count = options.burstSize ?? catalogueSlo.burstSize
  const timeoutS = options.timeoutS ?? 60
  const pollIntervalMs = options.pollIntervalMs ?? 500
  const runId = randomUUID()
  const capture = startCapture(env, pollIntervalMs)

  const startedAt = env.clock().toISOString()
  const t0 = env.now()
  const samples: PerfSample[] = []
  const jobIds: string[] = []
  const enqueuedAt = new Map<string, number>()
  const terminalAt = new Map<string, { atMs: number; state: string }>()
  let cleanup: { removed: number; missing: number }
  let replyIds: readonly string[]

  try {
    replyIds = await seam.prepare(count)

    // Phase 1: human-paced publication burst.
    const paceMs = 1000 / REPLY_BURST_PACE_PER_SEC
    let nextAt = env.now()
    for (const replyId of replyIds) {
      const jobId = `perf-reply-${runId}-${replyId}`
      const s0 = env.now()
      const sampleStartedAt = env.clock().toISOString()
      let ok = true
      try {
        await seam.enqueuePublish(replyId, jobId)
        jobIds.push(jobId)
        enqueuedAt.set(replyId, s0)
      } catch {
        ok = false
      }
      samples.push({
        name: 'publish-enqueue',
        startedAt: sampleStartedAt,
        durationMs: env.now() - s0,
        ok,
      })
      nextAt += paceMs
      const wait = nextAt - env.now()
      if (wait > 0) await env.sleep(wait)
    }

    // Phase 2: poll the durable publication state until every reply is
    // terminal or the measurement deadline passes.
    const deadline = env.now() + timeoutS * 1000
    while (terminalAt.size < replyIds.length && env.now() < deadline) {
      await capture.tick()
      const states = await seam.publicationStates(replyIds)
      const nowMs = env.now()
      for (const replyId of replyIds) {
        if (terminalAt.has(replyId)) continue
        const state = states.get(replyId)
        if (state && TERMINAL_PUBLICATION_STATES.has(state)) {
          terminalAt.set(replyId, { atMs: nowMs, state })
          const started = enqueuedAt.get(replyId)
          if (started != null) {
            samples.push({
              name: 'publish-terminal',
              startedAt: env.clock().toISOString(),
              durationMs: nowMs - started,
              ok: true,
            })
          }
        }
      }
      if (terminalAt.size < replyIds.length) await env.sleep(pollIntervalMs)
    }
  } finally {
    cleanup = await env.removeJobs(jobIds)
    await seam.cleanup()
  }

  const elapsedMs = env.now() - t0
  const series = await capture.stop()
  const enqueueSamples = samples.filter((s) => s.name === 'publish-enqueue')
  const terminalSamples = samples.filter((s) => s.name === 'publish-terminal')
  const enqueueSummary = summarizeSamples(enqueueSamples, elapsedMs)
  const terminalSummary =
    terminalSamples.length > 0
      ? summarizeSamples(terminalSamples, elapsedMs)
      : { count: 0, errors: 0, p50: 0, p95: 0, p99: 0, mean: 0, max: 0, ratePerSec: 0 }
  const stateCount = (name: string) =>
    [...terminalAt.values()].filter((t) => t.state === name).length

  const assertions: Assertion[] = [
    {
      check: 'required_samples',
      passed: enqueueSamples.length > 0,
      detail: `${enqueueSamples.length} publish enqueues, ${terminalSamples.length} terminal observations`,
    },
    {
      check: 'enqueue_error_free',
      passed: enqueueSummary.errors === 0,
      detail: `${enqueueSummary.errors} publish enqueue failures`,
    },
    {
      check: 'all_terminal',
      passed: terminalAt.size === replyIds.length,
      detail: `${terminalAt.size}/${replyIds.length} replies reached a terminal state within ${timeoutS}s`,
    },
    {
      check: 'publish_terminal_p95_within_slo',
      passed:
        terminalSamples.length > 0 && terminalSummary.p95 <= SLOS.replyPublishTerminalP95,
      detail: `publish→terminal p95 ${terminalSummary.p95.toFixed(1)}ms vs ${SLOS.replyPublishTerminalP95}ms (ADR 0038)`,
    },
    {
      check: 'monitoring_captured',
      passed: series.points.length > 0,
      detail: `${series.points.length} points, ${series.readErrors.length} read errors`,
    },
  ]

  const metrics: Record<string, number | string> = {
    burstSize: replyIds.length,
    published: stateCount('published'),
    terminal: stateCount('terminal'),
    ambiguous: stateCount('ambiguous'),
    publishP50: Number(terminalSummary.p50.toFixed(2)),
    publishP95: Number(terminalSummary.p95.toFixed(2)),
    publishP99: Number(terminalSummary.p99.toFixed(2)),
    removedOnCleanup: cleanup.removed,
    cleanupMissed: cleanup.missing,
    executedDurationS: Number((elapsedMs / 1000).toFixed(3)),
  }

  return {
    record: buildRecord(
      env,
      'replyBurst',
      startedAt,
      elapsedMs,
      metrics,
      assertions,
      { ...catalogueSlo },
      { count: samples.length, errors: enqueueSummary.errors },
      { points: series.points.length, readErrors: series.readErrors.length },
    ),
    raw: { samples, monitoring: series },
  }
}

// ── BQC-8.3: source lifecycle at scale ───────────────────────────────

async function runRetention(
  env: ScenarioRunEnv,
  _options: ScenarioRunOptions,
): Promise<ScenarioRunOutcome> {
  const startedAt = env.clock().toISOString()
  const startedMs = env.now()
  const capture = startCapture(env, 1_000)
  await capture.tick()

  if (!env.lifecycle) {
    const series = await capture.stop()
    const assertions: Assertion[] = [
      {
        check: 'lifecycle harness configured',
        passed: false,
        detail: 'retention executor requires the production lifecycle seam',
      },
    ]
    return {
      record: buildRecord(
        env,
        'retention',
        startedAt,
        env.now() - startedMs,
        {},
        assertions,
        { ...SCENARIOS.retention.slo },
        { count: 0, errors: 1 },
        { points: series.points.length, readErrors: series.readErrors.length },
      ),
      raw: { samples: [], monitoring: series },
    }
  }

  let result: RetentionRunSummary | undefined
  let runError: string | undefined
  const sampleStartedAt = env.clock().toISOString()
  const sampleStartedMs = env.now()
  try {
    result = await env.lifecycle.runRetention()
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error)
  }
  const samples: PerfSample[] = [
    {
      name: 'retention',
      startedAt: sampleStartedAt,
      durationMs: env.now() - sampleStartedMs,
      ok: result != null,
    },
  ]
  await capture.tick()
  const series = await capture.stop()

  const assertions: Assertion[] =
    result == null
      ? [
          {
            check: 'lifecycle sweep completed',
            passed: false,
            detail: runError ?? 'retention seam returned no result',
          },
        ]
      : [
          {
            check: 'all expired content removed',
            passed: result.expiredAfter === 0,
            detail: `${result.expiredAfter} expired rows remain`,
          },
          {
            check: 'purge accounted for every expired row',
            passed: result.purged === result.expiredBefore,
            detail: `purged ${result.purged} of ${result.expiredBefore}`,
          },
          {
            check: 'registered-copy canaries disappeared',
            passed: result.canariesChecked > 0 && result.canariesRemaining === 0,
            detail: `${result.canariesRemaining}/${result.canariesChecked} canaries remain`,
          },
          {
            check: 'lifecycle sweep remained keyset bounded',
            passed: result.bounded,
          },
        ]

  return {
    record: buildRecord(
      env,
      'retention',
      startedAt,
      env.now() - startedMs,
      result == null
        ? {}
        : {
            expiredBefore: result.expiredBefore,
            purged: result.purged,
            expiredAfter: result.expiredAfter,
            batches: result.batches,
            canariesChecked: result.canariesChecked,
            canariesRemaining: result.canariesRemaining,
          },
      assertions,
      { ...SCENARIOS.retention.slo },
      { count: samples.length, errors: samples.filter((sample) => !sample.ok).length },
      { points: series.points.length, readErrors: series.readErrors.length },
    ),
    raw: { samples, monitoring: series },
  }
}

// ── BQC-8.4/8.5: runtime and regional fault matrix ──────────────────

async function runFault(
  fault: FaultName,
  env: ScenarioRunEnv,
  _options: ScenarioRunOptions,
): Promise<ScenarioRunOutcome> {
  const startedAt = env.clock().toISOString()
  const startedMs = env.now()
  const capture = startCapture(env, 1_000)
  await capture.tick()

  if (!env.faults) {
    const series = await capture.stop()
    const assertions: Assertion[] = [
      {
        check: 'fault controller configured',
        passed: false,
        detail: `${fault} requires a production fault controller`,
      },
    ]
    return {
      record: buildRecord(
        env,
        fault,
        startedAt,
        env.now() - startedMs,
        {},
        assertions,
        { fault },
        { count: 0, errors: 1 },
        { points: series.points.length, readErrors: series.readErrors.length },
      ),
      raw: { samples: [], monitoring: series },
    }
  }

  let result: FaultRunSummary | undefined
  let runError: string | undefined
  const sampleStartedAt = env.clock().toISOString()
  const sampleStartedMs = env.now()
  try {
    result = await env.faults.execute(fault)
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error)
  }
  const samples: PerfSample[] = [
    {
      name: fault,
      startedAt: sampleStartedAt,
      durationMs: env.now() - sampleStartedMs,
      ok: result != null,
    },
  ]
  await capture.tick()
  const series = await capture.stop()

  const assertions: Assertion[] =
    result == null
      ? [
          {
            check: 'fault execution completed',
            passed: false,
            detail: runError ?? 'fault controller returned no result',
          },
        ]
      : [
          {
            check: 'fault identity matches requested matrix row',
            passed: result.fault === fault,
            detail: `controller reported ${result.fault}`,
          },
          { check: 'fault injection confirmed', passed: result.injected },
          { check: 'fault recovery confirmed', passed: result.recovered },
          ...result.assertions,
        ]

  return {
    record: buildRecord(
      env,
      fault,
      startedAt,
      env.now() - startedMs,
      result?.metrics ?? {},
      assertions,
      { fault },
      { count: samples.length, errors: samples.filter((sample) => !sample.ok).length },
      { points: series.points.length, readErrors: series.readErrors.length },
    ),
    raw: { samples, monitoring: series },
  }
}

function faultExecutor(fault: FaultName): ScenarioExecutor {
  return (env, options) => runFault(fault, env, options)
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
  // BQC-8.2 capacity executors.
  singlePropertyBurst: runSinglePropertyBurst,
  reconnect: runReconnect,
  fleetDispatch: runFleetDispatch,
  dashboardCold: runDashboardCold,
  replyBurst: runReplyBurst,
  retention: runRetention,
}

/**
 * Every catalogue fault has an executor. A controller is still mandatory at
 * run time, which is the fail-closed boundary between a testable harness and
 * an actual staging fault injection.
 */
export const FAULT_EXECUTORS: Record<FaultName, ScenarioExecutor> = {
  dbFailurePreCommit: faultExecutor('dbFailurePreCommit'),
  dbFailurePostCommit: faultExecutor('dbFailurePostCommit'),
  relayCrashAfterClaim: faultExecutor('relayCrashAfterClaim'),
  relayCrashAfterRedis: faultExecutor('relayCrashAfterRedis'),
  redisUnavailable: faultExecutor('redisUnavailable'),
  workerSigterm: faultExecutor('workerSigterm'),
  workerForceKill: faultExecutor('workerForceKill'),
  duplicateEvents: faultExecutor('duplicateEvents'),
  poisonPayload: faultExecutor('poisonPayload'),
  gbpRateLimit: faultExecutor('gbpRateLimit'),
  cacheOutage: faultExecutor('cacheOutage'),
  lifecyclePurgeRace: faultExecutor('lifecyclePurgeRace'),
}

export function getScenarioExecutor(name: string): ScenarioExecutor | undefined {
  return SCENARIO_EXECUTORS[name as ScenarioName]
}

export function getFaultExecutor(name: string): ScenarioExecutor | undefined {
  return FAULT_EXECUTORS[name as FaultName]
}
