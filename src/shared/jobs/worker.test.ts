// Worker runtime policy invariants.
//
// Both invariants below are cross-module and were previously only implicit —
// the numbers lived in three files with nothing tying them together, and both
// were violated: the BullMQ defaults put stalled recovery INSIDE the claim
// lease, and default-queue concurrency equalled the pool max. The pool budget
// now covers every queue: src/worker/pool-budget.test.ts.

import { describe, expect, it } from 'vitest'
import { GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS } from '#/contexts/integration/application/ports/google-import-v2-store.port'
import {
  JOB_LOCK_DURATION_MS,
  JOB_STALLED_INTERVAL_MS,
  jobQueueRateLimit,
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

describe('job-start rate limits', () => {
  // BullMQ's limiter releases a window's jobs at once and then idles. With
  // short domain events that idle dominated: a 96-review import dispatched
  // exactly ten events a second and left the dispatcher idle 97% of the time.
  it('leaves domain-event dispatch bounded by its concurrency alone', () => {
    expect(jobQueueRateLimit('domain-events')).toBeNull()
  })

  it('keeps the limit the default and background queues always had', () => {
    for (const queue of ['default', 'background']) {
      expect(jobQueueRateLimit(queue)).toEqual({ max: 10, duration: 1_000 })
    }
  })

  it('gives a queue the catalogue does not name the default limit', () => {
    expect(jobQueueRateLimit('some-test-queue')).toEqual(jobQueueRateLimit('default'))
  })
})
