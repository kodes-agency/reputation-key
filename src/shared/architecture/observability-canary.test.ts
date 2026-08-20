// BQC-7.3 — the OperationsSnapshot carries no tenant identifiers.
//
// A fully assembled OperationsSnapshot is deep-walked: no value may carry an
// organization/property/user-shaped identifier (uuid / nanoid shape) — the
// snapshot has no approved correlation fields at all, so any
// identifier-shaped value is a leak. The log-side pin (seeded canary through
// the sync job's old jobData dump path) lives next to the job:
// contexts/review/infrastructure/jobs/sync-property-reviews.canary.test.ts.

import { describe, it, expect, vi } from 'vitest'
import { createOperationsSnapshot } from '#/shared/health/operations-snapshot'
import type { Database } from '#/shared/db'
import type { OutboxRepository } from '#/shared/outbox'

function deepValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(deepValues)
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(deepValues)
  }
  return [value]
}

/** A thenable select-chain returning queued per-query results in call order. */
function fakeDb(results: unknown[][]): Database {
  let call = 0
  const makeChain = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.then = (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject)
    return chain
  }
  return { select: vi.fn(() => makeChain(results[call++] ?? [])) } as unknown as Database
}

// Identifier shapes: RFC-4122 UUID and nanoid (21-char URL-safe alphabet).
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NANOID_SHAPE = /^[A-Za-z0-9_-]{21}$/

describe('canary: the OperationsSnapshot carries no tenant identifiers (BQC-7.3)', () => {
  it('no uuid/nanoid-shaped value survives into the snapshot', async () => {
    const reader = createOperationsSnapshot({
      db: fakeDb([
        [{ cnt: 1, age_ms: 10 }],
        [{ claimed: 0, oldest_claimed_age_ms: null, stalled: 0 }],
        [{ total: 1, refresh_due: 0, expired: 0, oldest_due_age_seconds: null }],
        [{ due: 0, failed: 0 }],
        [
          {
            requested: 0,
            authorized: 0,
            sending: 0,
            published: 1,
            terminal: 0,
            ambiguous: 0,
            cancelled: 0,
            oldest_ambiguous_age_ms: null,
          },
        ],
      ]),
      outboxRepo: {
        findExpiredLeases: vi.fn(async () => []),
      } as unknown as OutboxRepository,
      queues: {
        default: { getJobCounts: vi.fn(async () => ({ waiting: 1 })) },
        background: null,
        domainEvents: null,
        quarantine: {
          getJobCounts: vi.fn(async () => ({ waiting: 1 })),
          getJobs: vi.fn(async () => []),
        },
      },
      redis: null,
      clock: () => new Date('2026-01-15T12:00:00.000Z'),
      versions: {
        capabilityPolicy: 'bqc-0.3',
        executionPolicy: 'bqc-0.3',
        policyStore: () => 3,
        routingPolicy: 1,
        sourceContentPolicy: 1,
      },
      runtime: {
        poolStats: () => ({ max: 10, totalCount: 1, idleCount: 1, waitingCount: 0 }),
        migrationVersion: async () => 17,
        releaseSha: () => 'abc1234',
        tenantCache: () => ({ hits: 0, misses: 0, evictions: 0, size: 0 }),
      },
    })

    const snapshot = await reader.read()
    const stringValues = deepValues(snapshot).filter(
      (v): v is string => typeof v === 'string',
    )

    // Sanity: the snapshot DOES carry string values (names, versions,
    // timestamps) — the walk is not vacuous.
    expect(stringValues.length).toBeGreaterThan(5)
    for (const value of stringValues) {
      expect(UUID_SHAPE.test(value), `uuid-shaped value in snapshot: ${value}`).toBe(
        false,
      )
      expect(NANOID_SHAPE.test(value), `nanoid-shaped value in snapshot: ${value}`).toBe(
        false,
      )
    }
  })
})
