// Shared database pool — single connection pool for both Drizzle and Better Auth.
// Per Issue 6: Auth and Drizzle each created their own Pool, doubling connections.
// This module provides a single Pool shared across the application.

import { Pool } from 'pg'

import { getEnv } from '#/shared/config/env'

let _pool: Pool | undefined
let _warmupPromise: Promise<void> | undefined

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Transient connection errors ────────────────────────────────────
// Neon (serverless Postgres) suspends the compute endpoint when idle.
// The first connection after a suspend fails with a TCP-level timeout;
// recycled idle connections fail with "Connection terminated". Both are
// transient — the endpoint is waking up, not permanently broken.

const TRANSIENT_CODES = new Set([
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'ECONNRESET',
  'EPIPE',
  'ECONNREFUSED',
])

export function isTransientConnectionError(err: unknown): boolean {
  const walk = (e: unknown): boolean => {
    if (!e || typeof e !== 'object') return false
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string' && TRANSIENT_CODES.has(code)) return true
    // pg-pool wraps concurrent IPv4/IPv6 attempts in an AggregateError.
    const inner = (e as { errors?: unknown[] }).errors
    if (Array.isArray(inner)) return inner.some(walk)
    const msg = (e as { message?: unknown }).message
    if (
      typeof msg === 'string' &&
      /connection terminated|server closed the connection unexpectedly/i.test(msg)
    ) {
      return true
    }
    return false
  }
  return walk(err)
}

/** Retry a promise-returning operation on transient connection errors. */
async function retryTransient<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isTransientConnectionError(err) || attempt >= maxAttempts) throw err
      await delay(500 * 2 ** attempt)
    }
  }
}

/**
 * Wrap pool.connect() and pool.query() so the promise form of each retries
 * on transient network errors. Kysely (Better Auth) calls pool.connect()
 * directly. Drizzle calls pool.query() — which internally uses the callback
 * form of connect(), so the connect() wrapper alone does not cover it.
 * Wrapping both promise forms covers every query path without modifying
 * either library. Callback-form callers (pg's internal pool.query delegate)
 * are passed through untouched.
 */
function wrapPoolWithRetry(pool: Pool): void {
  const originalConnect = pool.connect.bind(pool)
  pool.connect = ((...args: Parameters<typeof originalConnect>) => {
    if (args.length > 0) return originalConnect(...args)
    return retryTransient(() => originalConnect())
  }) as typeof pool.connect
  const originalQuery = pool.query.bind(pool)
  pool.query = ((...args: Parameters<typeof originalQuery>): unknown => {
    if (typeof args.at(-1) === 'function') return originalQuery(...args)
    return retryTransient(() => originalQuery(...args) as unknown as Promise<unknown>)
  }) as typeof pool.query
}

/**
 * Eagerly establish and verify the first connection so the first user
 * request doesn't fail on a cold Neon connection. Neon (serverless Postgres)
 * suspends the compute endpoint when idle; the first connection after a
 * suspend can fail. This retries until the pool has a healthy client.
 * Fire-and-forget — requests that arrive during warmup use the pool normally.
 */
async function warmup(pool: Pool): Promise<void> {
  for (let i = 0; i < 6; i++) {
    let client
    try {
      client = await pool.connect()
      await client.query('SELECT 1')
      return
    } catch {
      await delay(1000)
    } finally {
      client?.release()
    }
  }
}

/** Await the fire-and-forget warmup. Cold-start-critical callers (auth,
 * tenant resolution) can guarantee a warm connection before their first
 * query by awaiting this. */
export function ensurePoolWarmed(): Promise<void> {
  if (!_warmupPromise) getPool()
  return _warmupPromise ?? Promise.resolve()
}

/** Get the shared database connection pool. Creates it on first call. */
export function getPool(): Pool {
  if (!_pool) {
    const env = getEnv()
    _pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      // Neon (serverless Postgres) recycles connections when the compute
      // endpoint suspends. These timeouts keep the pool from hanging on a
      // dead connection and fail fast so the request errors instead of
      // stalling indefinitely.
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 30_000,
    })
    // CRITICAL for Neon: when the serverless runtime closes an idle client
    // behind our back, the Pool emits 'error'. Without a listener Node treats
    // it as an unhandled exception, which destabilizes the process and causes
    // cascading 500s. This handler logs and lets the Pool recycle the client.
    _pool.on('error', (err) => {
      console.warn('[db] idle pool connection error (Neon recycled connection):', err.message)
    })
    // Retry transient connection failures (Neon cold-start, recycled
    // connections) at the pool level — wraps connect() + query() so both
    // Kysely (Better Auth) and Drizzle queries survive a cold Neon endpoint.
    wrapPoolWithRetry(_pool)
    // Warm the first connection (fire-and-forget; awaitable via
    // ensurePoolWarmed). Retries internally.
    _warmupPromise = warmup(_pool)
  }
  return _pool
}
