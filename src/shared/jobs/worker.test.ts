// Worker runtime policy invariants.
//
// Both invariants below are cross-module and were previously only implicit —
// the numbers lived in three files with nothing tying them together, and both
// were violated: the BullMQ defaults put stalled recovery INSIDE the claim
// lease, and default-queue concurrency equalled the pool max.

import { describe, expect, it } from 'vitest'
import { GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS } from '#/contexts/integration/application/ports/google-import-v2-store.port'
import { POOL_MAX_CONNECTIONS } from '#/shared/db/pool'
import {
  BACKGROUND_QUEUE_CONCURRENCY,
  DEFAULT_QUEUE_CONCURRENCY,
  JOB_LOCK_DURATION_MS,
  JOB_STALLED_INTERVAL_MS,
  WORST_CASE_POOL_CLIENTS_PER_JOB,
} from './worker'

describe('BullMQ lock/stall ordering', () => {
  // A stalled re-run arriving while the domain claim lease is still valid
  // cannot claim the item; it burns the single permitted stalled recovery
  // (maxStalledCount 1) and the row stays 'processing' until its effect
  // deadline. STRICTLY shorter, not equal: at equality the re-run races the
  // lease boundary.
  it('expires every domain claim lease strictly before a job can stall', () => {
    expect(GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS).toBeLessThan(JOB_LOCK_DURATION_MS)
  })

  it('never detects a stall before the lock it is detecting could expire', () => {
    expect(JOB_LOCK_DURATION_MS).toBeLessThanOrEqual(JOB_STALLED_INTERVAL_MS)
  })
})

describe('worker concurrency / connection-pool budget', () => {
  // The Google-import item job holds its fenced `FOR UPDATE` transaction while
  // the nested Property effect opens a second one. With concurrency == pool
  // max, every slot holds a client and every nested acquisition waits out
  // connectionTimeoutMillis — a deterministic self-starvation reported to
  // tenants as a spurious `temporarily_unavailable`.
  it('leaves headroom for the nested effect under the pool max', () => {
    const peakDefaultQueueClients =
      DEFAULT_QUEUE_CONCURRENCY * WORST_CASE_POOL_CLIENTS_PER_JOB
    expect(peakDefaultQueueClients).toBeLessThanOrEqual(POOL_MAX_CONNECTIONS)
  })

  it('keeps spare clients for the background worker and relay', () => {
    const peakDefaultQueueClients =
      DEFAULT_QUEUE_CONCURRENCY * WORST_CASE_POOL_CLIENTS_PER_JOB
    expect(POOL_MAX_CONNECTIONS - peakDefaultQueueClients).toBeGreaterThan(0)
    // Background sweeps are single-client, so the spare pool must cover at
    // least one of them concurrently with a saturated default queue.
    expect(BACKGROUND_QUEUE_CONCURRENCY).toBeGreaterThan(0)
  })
})
