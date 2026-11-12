// The worker's database pool, sized from everything the worker runs at once.
//
// The worker used web's pool of 10 while its queues could hold about 45
// clients. On the closed beta (2026-09-29) a 244-review import exhausted it:
// the Inbox projection held the Property fence while waiting for a client, and
// every consumer queued on that fence failed at the lock timeout. Exact-current
// applies now run the consumer on the Review transaction's own client, and this
// budget gives every queue the clients its configured concurrency can hold, so
// none of them waits on the pool at its planned load.
//
// Parallel reads that fan out per recipient or per cycle (the feed
// consumers) are not bounded here. They hold no lock while waiting for
// a client, so past the budget they only queue.

import { AI_BACKLOG_DRAIN_CONCURRENCY } from '#/contexts/ai/application/public-api'
import {
  BACKGROUND_QUEUE_CONCURRENCY,
  DEFAULT_QUEUE_CONCURRENCY,
  DOMAIN_EVENTS_QUEUE_CONCURRENCY,
  WORST_CASE_POOL_CLIENTS_PER_JOB,
} from '#/shared/jobs/worker'

/**
 * Most pool clients one job holds at the same instant, per queue (audited
 * 2026-09-29).
 * - default: the urgent and mandatory email jobs read three things in
 *   parallel; the Google import item holds two, one while it waits for the
 *   other (`WORST_CASE_POOL_CLIENTS_PER_JOB`).
 * - background: health-check's operations snapshot reads about six things in
 *   parallel. The AI backlog drain is budgeted on its own.
 * - domain-events: one session isolates live work plus one consumer client.
 *   An exact-current apply runs on that consumer client.
 */
const PEAK_CLIENTS_PER_JOB = Object.freeze({
  default: Math.max(3, WORST_CASE_POOL_CLIENTS_PER_JOB),
  background: 6,
  'domain-events': 2,
})

/** Outbox admission, work reconciliation and scheduler repair may overlap. */
const RUNTIME_CLIENTS = 3

export const WORKER_POOL_CLIENT_BUDGET = Object.freeze({
  defaultQueue: DEFAULT_QUEUE_CONCURRENCY * PEAK_CLIENTS_PER_JOB.default,
  // A worker runs one drain at a time (a second returns at once); the other
  // background slots run sweeps.
  backgroundQueue:
    AI_BACKLOG_DRAIN_CONCURRENCY +
    (BACKGROUND_QUEUE_CONCURRENCY - 1) * PEAK_CLIENTS_PER_JOB.background,
  domainEvents: DOMAIN_EVENTS_QUEUE_CONCURRENCY * PEAK_CLIENTS_PER_JOB['domain-events'],
  runtime: RUNTIME_CLIENTS,
})

/** The worker's pool size, passed to `configurePoolMaxConnections` at boot. */
export const WORKER_POOL_MAX_CONNECTIONS = Object.values(
  WORKER_POOL_CLIENT_BUDGET,
).reduce((total, clients) => total + clients, 0)

/**
 * Connection limit of the closed-beta-v2 PostgreSQL, read on 2026-09-29 with
 * `railway ssh --service Postgres -- psql -U postgres -d railway -Atc
 * "show max_connections"` (and `superuser_reserved_connections`). Read it again
 * after a plan or major-version change; the budget test checks both pools fit.
 */
export const DATABASE_CONNECTION_LIMIT = Object.freeze({
  maxConnections: 500,
  superuserReserved: 3,
})

/** Connections kept free for web's pre-deploy migrations, ops commands and psql. */
export const OPERATOR_CONNECTION_HEADROOM = 20
