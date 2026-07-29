// Health probe shapes for liveness / readiness / startup (BQR-6.1, BQC-7.2).
// Liveness: process is up (orchestration may restart if this fails).
// Readiness: dependencies required to serve traffic (DB + Redis + migration
// journal match + policy state readable).
// Startup: boot/config initialization complete (container built + migrations
// + policy) — the platform activation gate.
//
// This module stays PURE (no DB/Redis imports): the liveness pin test scans
// the source to keep it that way. Probe implementations and time budgets
// live in ./readiness (which may touch the shared db pool).

export type LiveProbe = Readonly<{
  status: 'ok'
  timestamp: string
}>

export type ReadyProbe = Readonly<{
  status: 'ok' | 'degraded'
  db: boolean
  redis: boolean
  migrations: boolean
  policy: boolean
  timestamp: string
}>

export type StartupProbe = Readonly<{
  status: 'ok' | 'degraded'
  container: boolean
  migrations: boolean
  policy: boolean
  timestamp: string
}>

export function liveProbe(now: () => Date = () => new Date()): LiveProbe {
  return {
    status: 'ok',
    timestamp: now().toISOString(),
  }
}

export function readyProbe(
  deps: Readonly<{ db: boolean; redis: boolean; migrations: boolean; policy: boolean }>,
  now: () => Date = () => new Date(),
): ReadyProbe {
  const ok = deps.db && deps.redis && deps.migrations && deps.policy
  return {
    status: ok ? 'ok' : 'degraded',
    db: deps.db,
    redis: deps.redis,
    migrations: deps.migrations,
    policy: deps.policy,
    timestamp: now().toISOString(),
  }
}

export function startupProbe(
  deps: Readonly<{ container: boolean; migrations: boolean; policy: boolean }>,
  now: () => Date = () => new Date(),
): StartupProbe {
  const ok = deps.container && deps.migrations && deps.policy
  return {
    status: ok ? 'ok' : 'degraded',
    container: deps.container,
    migrations: deps.migrations,
    policy: deps.policy,
    timestamp: now().toISOString(),
  }
}

export function probeHttpStatus(status: 'ok' | 'degraded'): 200 | 503 {
  return status === 'ok' ? 200 : 503
}
