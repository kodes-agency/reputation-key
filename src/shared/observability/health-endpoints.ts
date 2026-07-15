// BETA-3 B3.6: Health check endpoints.
//
// Split health semantics per the plan:
// - Liveness: process alive, no remote checks. Fast, always 200 if running.
// - Readiness: can accept traffic. Checks mandatory dependencies (DB, Redis).
// - Diagnostics: detailed state for operators (queue depth, lag, versions).
//
// The orchestrator should probe liveness for restart decisions and
// readiness for traffic routing. Liveness must never flap on optional
// dependency loss.

export type HealthStatus = 'ok' | 'degraded' | 'down'

export type LivenessResult = Readonly<{
  status: 'ok'
  uptime: number
  timestamp: string
}>

export type ReadinessResult = Readonly<{
  status: HealthStatus
  checks: Readonly<Record<string, { status: HealthStatus; latencyMs?: number }>>
  timestamp: string
}>

export type DiagnosticsResult = Readonly<{
  status: HealthStatus
  version: string
  env: string
  checks: Readonly<Record<string, unknown>>
  timestamp: string
}>

const startTime = Date.now()

/** Liveness — always returns ok if the process is running. */
export function getLiveness(): LivenessResult {
  return {
    status: 'ok',
    uptime: Math.round((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  }
}

/**
 * Readiness — checks mandatory dependencies.
 * Returns degraded (503) if any critical dependency is down.
 */
export async function getReadiness(deps: {
  checkDb: () => Promise<boolean>
  checkRedis: () => Promise<boolean>
}): Promise<ReadinessResult> {
  const timestamp = new Date().toISOString()

  const [dbStart, redisStart] = [Date.now(), Date.now()]
  const [dbOk, redisOk] = await Promise.all([deps.checkDb(), deps.checkRedis()])
  const dbLatency = Date.now() - dbStart
  const redisLatency = Date.now() - redisStart

  const checks = {
    db: { status: dbOk ? ('ok' as const) : ('down' as const), latencyMs: dbLatency },
    redis: {
      status: redisOk ? ('ok' as const) : ('down' as const),
      latencyMs: redisLatency,
    },
  }

  const allOk = dbOk && redisOk
  return {
    status: allOk ? 'ok' : 'degraded',
    checks,
    timestamp,
  }
}

/** HTTP status code for a health result. */
export function healthHttpStatus(status: HealthStatus): number {
  switch (status) {
    case 'ok':
      return 200
    case 'degraded':
      return 503
    case 'down':
      return 503
  }
}

/** Send a JSON health response. */
export function sendHealthResponse(
  result: LivenessResult | ReadinessResult | DiagnosticsResult,
  status: number,
): Response {
  return new Response(JSON.stringify(result), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
