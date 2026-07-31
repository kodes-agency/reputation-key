// BQC-8.1 — perf measurement primitives for the scale/recovery harnesses.
//
// Pure and dependency-free: percentile math, summary aggregation, a bounded-
// concurrency probe runner, and the JSON raw-sample store contract. Every
// time source is injected (clock for ISO timestamps, now() for monotonic
// durations) so unit tests run on virtual time and the CLI wires the real
// wall/monotonic clocks — per ADR 0017 no bare Date.now() in src.
//
// Raw samples are identifier-only (name, timestamp, duration, ok) — the
// harness never records payloads, tenant identifiers, or review content
// (ADR 0030), which is what makes the raw JSON safe to commit as evidence.

import type { Clock } from '#/shared/domain/clock'

/** One measured probe execution. */
export type PerfSample = Readonly<{
  /** Probe class, e.g. 'enqueue' or 'dashboard-read' (low-cardinality label). */
  name: string
  /** ISO-8601 start instant (from the injected clock). */
  startedAt: string
  /** Measured latency in milliseconds (from the injected monotonic clock). */
  durationMs: number
  /** False when the probe threw — recorded, never swallowed. */
  ok: boolean
}>

/** Aggregate statistics over a run's samples. */
export type PerfSummary = Readonly<{
  count: number
  errors: number
  p50: number
  p95: number
  p99: number
  mean: number
  max: number
  /** count / window — the achieved probe rate. */
  ratePerSec: number
}>

/**
 * Percentile via linear interpolation between closest ranks:
 * rank = (p/100)·(n−1); the value sits rank-fraction between the floor and
 * ceil order statistics. The series must be sorted ascending and non-empty.
 */
export function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) throw new Error('percentile of empty series')
  if (p < 0 || p > 100) throw new Error(`percentile ${p} out of range [0,100]`)
  if (sortedAscending.length === 1) return sortedAscending[0]
  const rank = (p / 100) * (sortedAscending.length - 1)
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  if (lower === upper) return sortedAscending[lower]
  const fraction = rank - lower
  return (
    sortedAscending[lower] + fraction * (sortedAscending[upper] - sortedAscending[lower])
  )
}

/**
 * Aggregate samples into a summary. `windowMs` is the measured run window
 * (the caller knows it; samples alone don't bound idle head/tail time), so
 * ratePerSec is the achieved throughput over the actual window.
 */
export function summarizeSamples(
  samples: readonly PerfSample[],
  windowMs: number,
): PerfSummary {
  if (windowMs <= 0) throw new Error(`window must be positive, got ${windowMs}`)
  if (samples.length === 0) {
    return { count: 0, errors: 0, p50: 0, p95: 0, p99: 0, mean: 0, max: 0, ratePerSec: 0 }
  }
  const durations = samples.map((s) => s.durationMs).sort((a, b) => a - b)
  const errors = samples.filter((s) => !s.ok).length
  const total = durations.reduce((acc, d) => acc + d, 0)
  return {
    count: samples.length,
    errors,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    mean: total / durations.length,
    max: durations[durations.length - 1],
    ratePerSec: samples.length / (windowMs / 1000),
  }
}

export type RunProbesOptions = Readonly<{
  /** Sample label (low-cardinality). */
  name: string
  /** Fixed number of probes — mutually exclusive with durationMs. */
  count?: number
  /** Run probes until this much monotonic time has elapsed. */
  durationMs?: number
  /** Max in-flight probes (worker-pool). Defaults to 1 (sequential). */
  concurrency?: number
  /** The unit of work; index is the probe sequence number. Throws → ok:false. */
  probe: (index: number) => Promise<void>
  clock: Clock
  /** Monotonic milliseconds (e.g. performance.now) — injected for tests. */
  now: () => number
  /** Yield between probes when pacing is needed — injected for tests. */
  sleep: (ms: number) => Promise<void>
}>

/**
 * Execute a probe repeatedly with bounded concurrency, collecting one sample
 * per execution. Probe failures are recorded as ok:false samples — a run
 * never aborts mid-measurement (the summary reports the error count).
 *
 * Stopping rule: with `count`, exactly count probes run; with `durationMs`,
 * no new probe starts once the deadline has passed (in-flight ones finish).
 */
export async function runProbes(
  options: RunProbesOptions,
): Promise<readonly PerfSample[]> {
  const { name, probe, clock, now } = options
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1))
  const count = options.count
  const durationMs = options.durationMs
  if ((count == null) === (durationMs == null)) {
    throw new Error('exactly one of count or durationMs is required')
  }
  if (count != null && count <= 0) throw new Error(`count must be positive, got ${count}`)
  if (durationMs != null && durationMs <= 0)
    throw new Error(`durationMs must be positive, got ${durationMs}`)

  const deadline = durationMs != null ? now() + durationMs : null
  const samples: PerfSample[] = []
  let nextIndex = 0

  const shouldDispatch = (): boolean => {
    if (count != null) return nextIndex < count
    return now() < (deadline as number)
  }

  const worker = async (): Promise<void> => {
    while (shouldDispatch()) {
      const index = nextIndex
      nextIndex += 1
      const startedAt = clock().toISOString()
      const t0 = now()
      let ok = true
      try {
        await probe(index)
      } catch {
        ok = false
      }
      samples.push({ name, startedAt, durationMs: now() - t0, ok })
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return samples
}

// ── Raw sample store (JSON) ──────────────────────────────────────────

/** Raw-store format version — bump on any shape change; parsers fail closed. */
export const SAMPLE_STORE_VERSION = 1 as const

/** Serialize samples for the raw evidence store (identifier-free JSON). */
export function serializeSamples(samples: readonly PerfSample[]): string {
  return JSON.stringify({ version: SAMPLE_STORE_VERSION, samples }, null, 2)
}

function isPerfSample(value: unknown): value is PerfSample {
  if (typeof value !== 'object' || value == null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.name === 'string' &&
    typeof v.startedAt === 'string' &&
    typeof v.durationMs === 'number' &&
    Number.isFinite(v.durationMs) &&
    typeof v.ok === 'boolean'
  )
}

/** Parse a raw sample file. Throws on any shape/version drift — fail closed. */
export function parseSamples(json: string): PerfSample[] {
  const parsed = JSON.parse(json) as unknown
  if (typeof parsed !== 'object' || parsed == null)
    throw new Error('sample store: not an object')
  const record = parsed as Record<string, unknown>
  if (record.version !== SAMPLE_STORE_VERSION)
    throw new Error(`sample store: unsupported version ${String(record.version)}`)
  if (!Array.isArray(record.samples) || !record.samples.every(isPerfSample))
    throw new Error('sample store: samples shape mismatch')
  return record.samples
}
