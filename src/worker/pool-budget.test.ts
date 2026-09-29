// The worker's pool must cover everything the worker can run at once.
//
// Until 2026-09-29 only the default queue was budgeted, against a pool of 10.
// The background drain (8 analyses), domain-event dispatch (10 consumers) and
// the exact-current applies shared the same 10 clients, and a 244-review import
// on the closed beta starved the pool.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AI_BACKLOG_DRAIN_CONCURRENCY } from '#/contexts/ai/application/use-cases/drain-review-analysis-backlog'
import {
  REVIEW_EXACT_CURRENT_APPLY_CLIENTS,
  REVIEW_EXACT_CURRENT_MAX_CONCURRENT_APPLIES,
} from '#/contexts/review/infrastructure/exact-current-apply-admission'
import { POOL_MAX_CONNECTIONS } from '#/shared/db/pool'
import {
  BACKGROUND_QUEUE_CONCURRENCY,
  DEFAULT_QUEUE_CONCURRENCY,
  DOMAIN_EVENTS_QUEUE_CONCURRENCY,
  WORST_CASE_POOL_CLIENTS_PER_JOB,
} from '#/shared/jobs/worker'
import {
  DATABASE_CONNECTION_LIMIT,
  OPERATOR_CONNECTION_HEADROOM,
  WORKER_POOL_CLIENT_BUDGET,
  WORKER_POOL_MAX_CONNECTIONS,
} from './pool-budget'

/**
 * Railway starts a new deployment and drains the old one for
 * `drainingSeconds`, so each service can briefly hold two pools.
 */
const DEPLOY_OVERLAP = 2

function replicas(config: URL): number {
  const parsed = JSON.parse(readFileSync(config, 'utf8')) as {
    deploy?: { numReplicas?: unknown }
  }
  const count = parsed.deploy?.numReplicas
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) {
    throw new Error(`${config.pathname} declares no replica count`)
  }
  return count
}

describe('worker pool budget', () => {
  it('sizes the pool to the sum of every budgeted consumer', () => {
    const budgeted = Object.values(WORKER_POOL_CLIENT_BUDGET).reduce(
      (total, clients) => total + clients,
      0,
    )
    expect(WORKER_POOL_MAX_CONNECTIONS).toBe(budgeted)
  })

  it('budgets every queue at no less than its configured concurrency needs', () => {
    expect(WORKER_POOL_CLIENT_BUDGET.defaultQueue).toBeGreaterThanOrEqual(
      DEFAULT_QUEUE_CONCURRENCY * WORST_CASE_POOL_CLIENTS_PER_JOB,
    )
    // One drain per worker runs its analyses at once, beside the other slots.
    expect(WORKER_POOL_CLIENT_BUDGET.backgroundQueue).toBeGreaterThanOrEqual(
      AI_BACKLOG_DRAIN_CONCURRENCY + BACKGROUND_QUEUE_CONCURRENCY - 1,
    )
    expect(WORKER_POOL_CLIENT_BUDGET.domainEvents).toBeGreaterThanOrEqual(
      DOMAIN_EVENTS_QUEUE_CONCURRENCY,
    )
    // Each admitted exact-current apply holds a second client for its consumer.
    expect(WORKER_POOL_CLIENT_BUDGET.exactCurrentApplies).toBeGreaterThanOrEqual(
      REVIEW_EXACT_CURRENT_MAX_CONCURRENT_APPLIES *
        (REVIEW_EXACT_CURRENT_APPLY_CLIENTS - 1),
    )
    expect(WORKER_POOL_CLIENT_BUDGET.runtime).toBeGreaterThanOrEqual(1)
  })

  it('never gives the worker a smaller pool than web', () => {
    expect(WORKER_POOL_MAX_CONNECTIONS).toBeGreaterThan(POOL_MAX_CONNECTIONS)
  })

  it('fits web and worker, both mid-deploy, under the database connection limit', () => {
    const webConnections =
      replicas(new URL('../../railway.json', import.meta.url)) * POOL_MAX_CONNECTIONS
    const workerConnections =
      replicas(new URL('../../railway.worker.json', import.meta.url)) *
      WORKER_POOL_MAX_CONNECTIONS
    const available =
      DATABASE_CONNECTION_LIMIT.maxConnections -
      DATABASE_CONNECTION_LIMIT.superuserReserved

    expect(
      DEPLOY_OVERLAP * (webConnections + workerConnections) +
        OPERATOR_CONNECTION_HEADROOM,
    ).toBeLessThanOrEqual(available)
  })
})
