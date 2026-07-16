// Worker heartbeat in Redis (BQR-6.2).
// Written by the health-check job; read by /api/health/metrics.
// Key is process-global, not tenant-scoped — no org/user identifiers.

export const WORKER_HEARTBEAT_KEY = 'ops:worker:heartbeat' as const

/** TTL slightly above the 5-minute health-check schedule (allows one miss). */
export const WORKER_HEARTBEAT_TTL_SECONDS = 900 as const

export type RedisHeartbeatPort = Readonly<{
  set: (key: string, value: string, mode: 'EX', seconds: number) => Promise<unknown>
  get: (key: string) => Promise<string | null>
}>

export type WorkerHeartbeat = Readonly<{
  at: string | null
  ageMs: number | null
  stale: boolean
}>

/** Stale if missing or older than 2× health-check interval (10 min). */
export const WORKER_HEARTBEAT_STALE_MS = 10 * 60 * 1000

export async function writeWorkerHeartbeat(
  redis: RedisHeartbeatPort | null | undefined,
  clock: () => Date = () => new Date(),
): Promise<void> {
  if (!redis) return
  await redis.set(
    WORKER_HEARTBEAT_KEY,
    clock().toISOString(),
    'EX',
    WORKER_HEARTBEAT_TTL_SECONDS,
  )
}

export async function readWorkerHeartbeat(
  redis: RedisHeartbeatPort | null | undefined,
  clock: () => Date = () => new Date(),
): Promise<WorkerHeartbeat> {
  if (!redis) {
    return { at: null, ageMs: null, stale: true }
  }
  const at = await redis.get(WORKER_HEARTBEAT_KEY)
  if (!at) {
    return { at: null, ageMs: null, stale: true }
  }
  const ageMs = Math.max(0, clock().getTime() - Date.parse(at))
  return {
    at,
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    stale: !Number.isFinite(ageMs) || ageMs > WORKER_HEARTBEAT_STALE_MS,
  }
}
