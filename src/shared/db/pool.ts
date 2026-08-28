// Shared database pool — single connection pool for both Drizzle and Better Auth.
// Per Issue 6: Auth and Drizzle each created their own Pool, doubling connections.
// This module provides a single Pool shared across the application.

import { Pool, type ClientBase } from 'pg'

import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'

// BQC-7.1: the production build bundles this module TWICE (the nitro app
// chunk and the lazy SSR service chunk each inline their own copy), so a
// module-level singleton would create two independent pools — and the
// graceful-shutdown plugin would close the copy requests never used.
// Symbol.for keys the singleton on the process-global registry so every
// bundle copy shares one pool.
const POOL_KEY = Symbol.for('repkey.shared.db.pool')
type PoolStore = { [POOL_KEY]?: Pool }

function poolStore(): PoolStore {
  return globalThis as PoolStore
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Transient connection errors ────────────────────────────────────
// A database restart, network route change, or recycled idle socket can fail
// connection acquisition transiently. Statements are deliberately excluded:
// once sent, their commit outcome may be ambiguous.

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

/** Total connection-acquisition attempts, including the initial try. */
export const CONNECTION_ACQUISITION_MAX_ATTEMPTS = 3

/** Retry connection acquisition on transient connection errors. */
async function retryTransient<T>(
  fn: () => Promise<T>,
  maxAttempts = CONNECTION_ACQUISITION_MAX_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isTransientConnectionError(err) || attempt >= maxAttempts) throw err
      await delay(500 * 2 ** (attempt - 1))
    }
  }
}

/**
 * Retry only pool.connect() acquisition failures. Once pool.query() has sent a
 * statement, a connection error is ambiguous: PostgreSQL may have committed
 * an autocommit write before the response was lost. Retrying that statement
 * here can duplicate a non-idempotent mutation. Callers that can prove safe
 * replay must implement it at their operation boundary with an idempotency
 * key or authoritative readback.
 *
 * Kysely (Better Auth) calls pool.connect() directly, so it receives the same
 * bounded acquisition recovery. Callback-form callers (including pg's
 * internal pool.query checkout) are passed through untouched.
 */
function wrapPoolConnectWithRetry(pool: Pool): void {
  const originalConnect = pool.connect.bind(pool)
  pool.connect = ((...args: Parameters<typeof originalConnect>) => {
    if (args.length > 0) return originalConnect(...args)
    return retryTransient(() => originalConnect())
  }) as typeof pool.connect
}

/**
 * Maximum physical connections per process pool. Exported because worker
 * concurrency is budgeted against it: see the
 * `concurrency * clients_per_job <= POOL_MAX_CONNECTIONS` invariant in
 * `#/shared/jobs/worker` (pinned by its unit test). Raising this without
 * re-checking that budget re-opens the self-starvation failure mode where
 * every worker slot holds a client while waiting for a nested one.
 */
export const POOL_MAX_CONNECTIONS = 10

/**
 * Role-level statement guards applied to every physical connection.
 *
 * `lock_timeout` bounds a row-lock wait. The Google-import claim path holds
 * `FOR UPDATE` on its item row across a nested effect, so an unbounded wait
 * would let one blocked attempt pin a pool client indefinitely; 10s is well
 * above any healthy contention and well below the job execution deadline.
 *
 * `idle_in_transaction_session_timeout` is the zombie bound: a transaction
 * that took `FOR UPDATE` and then stalled (e.g. its nested pool acquisition
 * hung) is terminated, releasing the row lock. The ordering that matters is
 *
 *   nested acquisition wait (connectionTimeoutMillis, 15s)
 *     < idle-in-transaction bound (30s)
 *     < Google-import claim lease (GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS, 60s)
 *
 * so a legitimate nested wait is never killed, yet a zombie always releases
 * the item row before its own claim lease expires — otherwise the claim
 * reaper's CAS release could be blocked by the very transaction it recovers.
 *
 * Termination surfaces as SQLSTATE 25P03 / a connection error, which the
 * import processor classifies as transient (release-and-retry), never as a
 * tenant-visible `internal_error`.
 */
export const SESSION_LOCK_TIMEOUT_MS = 10_000
export const SESSION_IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000

/**
 * pg-pool 3.14's `onConnect` hook is AWAITED before the client is handed to
 * the checkout caller (and a rejection closes the client instead of leaking
 * it), so unlike the synchronous `connect` event this cannot race the first
 * query. Applied per physical connection, not per checkout.
 */
async function applySessionGuards(client: ClientBase): Promise<void> {
  await client.query(
    `SET lock_timeout = ${SESSION_LOCK_TIMEOUT_MS}; ` +
      `SET idle_in_transaction_session_timeout = ${SESSION_IDLE_IN_TRANSACTION_TIMEOUT_MS}`,
  )
}

/** Get the shared database connection pool. Creates it on first call. */
export function getPool(): Pool {
  const store = poolStore()
  if (!store[POOL_KEY]) {
    const env = getEnv()
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: POOL_MAX_CONNECTIONS,
      // Bound acquisition and idle-socket lifetime so a dead route or
      // recycled connection cannot hold a request indefinitely.
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 30_000,
      onConnect: (client) => applySessionGuards(client),
    })
    // PostgreSQL, a proxy, or the network can close an idle client behind the
    // process. Pool emits `error`; handling it prevents an unhandled exception
    // while allowing pg-pool to retire that client.
    pool.on('error', (err) => {
      getLogger().warn({ error: err.message }, '[db] idle pool connection error')
    })
    // Retry only acquisition failures. Never replay pool.query(): a write may
    // have committed before a connection failure made its outcome ambiguous.
    wrapPoolConnectWithRetry(pool)
    store[POOL_KEY] = pool
  }
  return store[POOL_KEY]
}

/**
 * BQC-7.3 (db.pool.*): current pool gauges for the OperationsSnapshot.
 * Reads the EXISTING pool only — never creates one (a metrics read must not
 * cold-start the database). Returns null when the pool was never initialized.
 */
export function getPoolStats(): Readonly<{
  max: number
  totalCount: number
  idleCount: number
  waitingCount: number
} | null> {
  const pool = poolStore()[POOL_KEY]
  if (!pool) return null
  return {
    max: pool.options.max ?? 10,
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  }
}

/**
 * End the shared pool if it was created (BQC-7.1 graceful shutdown). No-op
 * when the pool was never initialized, so the shutdown path runs regardless
 * of whether any request touched the database. pool.end() waits for
 * checked-out clients to be released — in-flight queries finish, new
 * acquisitions fail. Resets the singleton so a later getPool() recreates.
 */
export async function closePool(): Promise<void> {
  const store = poolStore()
  const pool = store[POOL_KEY]
  store[POOL_KEY] = undefined
  if (pool) await pool.end()
}
