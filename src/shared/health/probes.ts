// Health probe shapes for liveness / readiness (BQR-6.1).
// Liveness: process is up (orchestration may restart if this fails).
// Readiness: dependencies required to serve traffic (DB + Redis).

export type LiveProbe = Readonly<{
  status: 'ok'
  timestamp: string
}>

export type ReadyProbe = Readonly<{
  status: 'ok' | 'degraded'
  db: boolean
  redis: boolean
  timestamp: string
}>

export function liveProbe(now: () => Date = () => new Date()): LiveProbe {
  return {
    status: 'ok',
    timestamp: now().toISOString(),
  }
}

export function readyProbe(
  deps: Readonly<{ db: boolean; redis: boolean }>,
  now: () => Date = () => new Date(),
): ReadyProbe {
  const ok = deps.db && deps.redis
  return {
    status: ok ? 'ok' : 'degraded',
    db: deps.db,
    redis: deps.redis,
    timestamp: now().toISOString(),
  }
}

export function probeHttpStatus(status: 'ok' | 'degraded'): 200 | 503 {
  return status === 'ok' ? 200 : 503
}
