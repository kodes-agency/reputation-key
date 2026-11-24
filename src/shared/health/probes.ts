// Health probe shapes for liveness / readiness / startup.
// Liveness: process is up (orchestration may restart if this fails).
// Readiness: what is required to serve traffic (container built + keys + DB +
// Redis + migration journal match + policy).
// Startup: boot/config initialization complete (container built + keys +
// migrations + policy).
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
  container: boolean
  keys: boolean
  db: boolean
  redis: boolean
  migrations: boolean
  policy: boolean
  timestamp: string
}>

export type StartupProbe = Readonly<{
  status: 'ok' | 'degraded'
  container: boolean
  keys: boolean
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

/** The probe body: ok only when every dependency reports true. */
export function probeBody<Deps extends Readonly<Record<string, boolean>>>(
  deps: Deps,
  now: () => Date = () => new Date(),
): Readonly<{ status: 'ok' | 'degraded'; timestamp: string }> & Deps {
  return {
    status: Object.values(deps).every(Boolean) ? 'ok' : 'degraded',
    ...deps,
    timestamp: now().toISOString(),
  }
}

export const readyProbe = (
  deps: Omit<ReadyProbe, 'status' | 'timestamp'>,
  now?: () => Date,
): ReadyProbe => probeBody(deps, now)

export const startupProbe = (
  deps: Omit<StartupProbe, 'status' | 'timestamp'>,
  now?: () => Date,
): StartupProbe => probeBody(deps, now)

export function probeHttpStatus(status: 'ok' | 'degraded'): 200 | 503 {
  return status === 'ok' ? 200 : 503
}
