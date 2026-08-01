// BQC-8.2 — external collectors: platform-side metrics the app cannot read
// from its own snapshot. Today: Redis memory/stats via the `redis-cli` binary
// (used_memory, peak, keyspace hits/misses, instantaneous ops — the §8.2 Redis
// memory/latency and cache-hit evidence). DB CPU/locks have NO app-readable
// or CLI surface here — they are recorded as
// 'not-collected-in-this-environment' in every run record's collectors
// section (platform observability is the acceptance surface); a gap is
// stated, never silent.
//
// The collector is optional: the CLI wires it only when a redis-cli binary
// exists on PATH. Points are numeric-only (no key names, no values, no
// credentials — the redis URL is passed to the CLI, never stored), so the
// series is safe to commit as raw evidence (ADR 0030).

import type { Clock } from '#/shared/domain/clock'

export type RedisInfoPoint = Readonly<{
  /** ISO-8601 capture instant (injected clock). */
  at: string
  usedMemoryBytes: number
  usedMemoryPeakBytes: number
  keyspaceHits: number
  keyspaceMisses: number
  instantaneousOpsPerSec: number
}>

export type ExternalCollectorSeries = Readonly<{
  collector: 'redis-info'
  points: readonly RedisInfoPoint[]
  readErrors: ReadonlyArray<Readonly<{ at: string; message: string }>>
}>

export type ExternalCollector = Readonly<{
  name: 'redis-info'
  /** Take one sample now. Never throws — failures land in readErrors. */
  tick: () => Promise<void>
  stop: () => Promise<ExternalCollectorSeries>
}>

const REQUIRED_FIELDS = [
  ['used_memory', 'usedMemoryBytes'],
  ['used_memory_peak', 'usedMemoryPeakBytes'],
  ['keyspace_hits', 'keyspaceHits'],
  ['keyspace_misses', 'keyspaceMisses'],
  ['instantaneous_ops_per_sec', 'instantaneousOpsPerSec'],
] as const

/**
 * Parse `redis-cli INFO` output into the SLO-relevant counters. Fails closed
 * when a required counter is absent — a partial sample is never recorded as
 * if it were complete.
 */
export function parseRedisInfo(info: string): Omit<RedisInfoPoint, 'at'> {
  const values = new Map<string, number>()
  for (const line of info.split('\n')) {
    const match = /^([a-z_]+):(-?[\d.]+)\s*$/.exec(line.trim())
    if (match) values.set(match[1], Number(match[2]))
  }
  const out: Record<string, number> = {}
  for (const [rawKey, pointKey] of REQUIRED_FIELDS) {
    const value = values.get(rawKey)
    if (value == null || !Number.isFinite(value)) {
      throw new Error(`redis INFO: required counter '${rawKey}' missing or non-numeric`)
    }
    out[pointKey] = value
  }
  return out as Omit<RedisInfoPoint, 'at'>
}

/**
 * One `redis-cli -u <url> INFO` per tick. `run` is the injected command seam
 * (the CLI passes a spawn-based runner; tests pass fakes).
 */
export function createRedisInfoCollector(deps: {
  redisUrl: string
  clock: Clock
  run: (args: readonly string[]) => Promise<string>
}): ExternalCollector {
  const points: RedisInfoPoint[] = []
  const readErrors: Array<{ at: string; message: string }> = []
  let inFlight: Promise<void> | null = null

  const tick = (): Promise<void> => {
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        const output = await deps.run(['-u', deps.redisUrl, 'INFO'])
        points.push({ at: deps.clock().toISOString(), ...parseRedisInfo(output) })
      } catch (err) {
        readErrors.push({
          at: deps.clock().toISOString(),
          message: err instanceof Error ? err.message : String(err),
        })
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  return {
    name: 'redis-info',
    tick,
    stop: async () => {
      if (inFlight) await inFlight
      return { collector: 'redis-info', points, readErrors }
    },
  }
}
