// BQC-8.1 — OperationsSnapshot capture: the monitoring time series every
// scenario run records alongside its probe samples.
//
// Two source modes, one contract:
//   viaContainer(reader) — in-process runs read the composition-owned
//     OperationsSnapshotReader directly (local proof without a web server);
//   viaHttp(baseUrl, token) — runs against a booted environment poll
//     GET /api/health/metrics with the x-ops-token gate (BQC-7.2).
//
// The per-point projection keeps ONLY the SLO-relevant sections (outbox,
// queue depths, db pool, heartbeat, reviews lifecycle, degraded markers).
// It is content-free BY CONSTRUCTION: the snapshot itself conforms to the
// BQC-7.3 schema (identifier-only, ADR 0030) and the projection narrows it
// further — release/versions identity belongs to the run record, not to
// every point. A failed read is recorded in readErrors, never swallowed.

import type { Clock } from '#/shared/domain/clock'
import type {
  OperationsDbSection,
  OperationsSnapshot,
  OperationsSnapshotReader,
} from '#/shared/health/operations-snapshot'
import type { HealthSnapshot } from '#/shared/observability/health-metrics'
import type { QueueDepth } from '#/shared/health/queue-depth'
import type { WorkerHeartbeat } from '#/shared/health/worker-heartbeat'

/** One captured monitoring point — the whitelisted SLO-relevant sections. */
export type SnapshotSeriesPoint = Readonly<{
  /** ISO-8601 capture instant (injected clock). */
  at: string
  outbox: HealthSnapshot['outbox']
  reviews: HealthSnapshot['reviews']
  queues: readonly QueueDepth[]
  heartbeat: WorkerHeartbeat
  db: OperationsDbSection
  degraded: readonly string[]
}>

/** A completed capture: points plus the reads that failed (never silent). */
export type SnapshotSeries = Readonly<{
  startedAt: string
  stoppedAt: string | null
  intervalMs: number
  points: readonly SnapshotSeriesPoint[]
  readErrors: ReadonlyArray<Readonly<{ at: string; message: string }>>
}>

/** The minimal read contract both modes satisfy. */
export type OpsSnapshotSource = Readonly<{
  read: () => Promise<OperationsSnapshot>
}>

/** In-process mode: read the composition-owned snapshot reader directly. */
export function viaContainer(reader: OperationsSnapshotReader): OpsSnapshotSource {
  return { read: () => reader.read() }
}

/**
 * HTTP mode: poll the ops-token-gated metrics endpoint of a booted
 * environment. Non-2xx throws — a failed poll lands in readErrors.
 */
export function viaHttp(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): OpsSnapshotSource {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/health/metrics`
  return {
    read: async () => {
      const response = await fetchImpl(url, { headers: { 'x-ops-token': token } })
      if (!response.ok) {
        throw new Error(`metrics endpoint responded ${response.status}`)
      }
      return (await response.json()) as OperationsSnapshot
    },
  }
}

/** Project a full snapshot to its whitelisted per-point series shape. */
export function toPoint(snapshot: OperationsSnapshot, at: Date): SnapshotSeriesPoint {
  return {
    at: at.toISOString(),
    outbox: snapshot.outbox,
    reviews: snapshot.reviews,
    queues: snapshot.queues,
    heartbeat: snapshot.workers.heartbeat,
    db: snapshot.db,
    degraded: snapshot.degraded,
  }
}

export type SnapshotCapture = Readonly<{
  /**
   * Take one read now and return the captured point (null when the read
   * failed or a previous read is still in flight). Executors drive ticks
   * from their own pacing so monitoring works on injected/virtual clocks.
   */
  tick: () => Promise<SnapshotSeriesPoint | null>
  /** Immediate tick + interval ticks (real timers) until stop(). */
  start: () => void
  /** Stop pacing, settle the in-flight read, return the series. */
  stop: () => Promise<SnapshotSeries>
}>

export function createCapture(deps: {
  source: OpsSnapshotSource
  intervalMs: number
  clock: Clock
}): SnapshotCapture {
  const { source, intervalMs, clock } = deps
  const startedAt = clock().toISOString()
  const points: SnapshotSeriesPoint[] = []
  const readErrors: Array<{ at: string; message: string }> = []
  let inFlight: Promise<SnapshotSeriesPoint | null> | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const tick = (): Promise<SnapshotSeriesPoint | null> => {
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        const snapshot = await source.read()
        const point = toPoint(snapshot, clock())
        points.push(point)
        return point
      } catch (err) {
        readErrors.push({
          at: clock().toISOString(),
          message: err instanceof Error ? err.message : String(err),
        })
        return null
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  return {
    tick,
    start: () => {
      if (timer) return
      void tick()
      timer = setInterval(() => void tick(), intervalMs)
      // A CLI's measurement window is bounded — the pacer alone must never
      // keep the process alive past the run.
      if (typeof timer.unref === 'function') timer.unref()
    },
    stop: async () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      if (inFlight) await inFlight
      return {
        startedAt,
        stoppedAt: clock().toISOString(),
        intervalMs,
        points,
        readErrors,
      }
    },
  }
}

// ── Raw series store (JSON) ──────────────────────────────────────────

/** Series store format version — bump on any shape change; parsers fail closed. */
export const SNAPSHOT_SERIES_VERSION = 1 as const

export function serializeSeries(series: SnapshotSeries): string {
  return JSON.stringify({ version: SNAPSHOT_SERIES_VERSION, ...series }, null, 2)
}

function isPoint(value: unknown): value is SnapshotSeriesPoint {
  if (typeof value !== 'object' || value == null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.at === 'string' &&
    typeof v.outbox === 'object' &&
    v.outbox != null &&
    Array.isArray(v.queues) &&
    typeof v.heartbeat === 'object' &&
    v.heartbeat != null &&
    typeof v.db === 'object' &&
    v.db != null &&
    Array.isArray(v.degraded)
  )
}

/** Parse a raw series file. Throws on any shape/version drift — fail closed. */
export function parseSeries(json: string): SnapshotSeries {
  const parsed = JSON.parse(json) as unknown
  if (typeof parsed !== 'object' || parsed == null)
    throw new Error('snapshot series: not an object')
  const record = parsed as Record<string, unknown>
  if (record.version !== SNAPSHOT_SERIES_VERSION)
    throw new Error(`snapshot series: unsupported version ${String(record.version)}`)
  if (
    typeof record.startedAt !== 'string' ||
    typeof record.intervalMs !== 'number' ||
    !Array.isArray(record.points) ||
    !record.points.every(isPoint) ||
    !Array.isArray(record.readErrors)
  )
    throw new Error('snapshot series: shape mismatch')
  return {
    startedAt: record.startedAt,
    stoppedAt: (record.stoppedAt as string | null) ?? null,
    intervalMs: record.intervalMs,
    points: record.points,
    readErrors: record.readErrors as SnapshotSeries['readErrors'],
  }
}
