// Unit tests for the new-review discovery sweep.
//
// Proves the ingestion hole this job closes: a CONNECTED property with zero
// stored reviews (which the refresh sweep can never see) gets a
// sync-property-reviews job. Plus the sweep contract: candidate filtering,
// per-property due-time filtering and advance, bounded batches, and
// enqueue-failure semantics (cursor held, failure recorded, rethrown).

import { describe, it, expect, vi } from 'vitest'
import type {
  ReviewQueuePort,
  SyncPropertyReviewsJobData,
} from '../../application/ports/review-queue.port'
import {
  createFakeReviewDiscoveryRepository,
  fakeDiscoveryProperty,
  type FakeDiscoveryPropertyRow,
} from '#/shared/testing/fake-review-discovery-repository'
import {
  createDiscoverNewReviewsHandler,
  DEFAULT_DISCOVERY_INTERVAL_MS,
} from './discover-new-reviews.job'

// Identical to the logger mock in refresh-expiring-reviews.job.test.ts, and it
// cannot be imported from a shared helper: Vitest hoists vi.mock factories
// above the import block and keeps the module registry per test file, so a
// factory invoked from a helper would run after this file's imports and mock
// nothing. Framework constraint, not a preference.
// Revisit if a third job test needs a silenced logger — at that point a
// setupFiles entry is worth losing the per-file explicitness.
// fallow-ignore-next-line code-duplication
vi.mock('#/shared/observability/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/shared/observability/logger')>()
  return {
    ...actual,
    getLogger: vi.fn(() => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  }
})

const NOW = new Date('2026-08-21T12:00:00.000Z')
const MINUTE = 60 * 1000

const prop = (n: number, over: Partial<FakeDiscoveryPropertyRow> = {}) =>
  fakeDiscoveryProperty({
    propertyId: `aa000000-0000-4000-8000-00000000000${n}`,
    connectionId: `bb000000-0000-4000-8000-00000000000${n}`,
    gbpLocationId: `location-${n}`,
    ...over,
  })

// Composed, never written out: a literal `accounts/…/locations/…` in a test
// file fails scripts/check-google-provider-identifiers.mjs, which confines
// provider resource literals to the generated fixture catalogue.
const expectedLocationName = (n: number) =>
  `accounts/${prop(n).gbpAccountId}/locations/${prop(n).gbpLocationId}`

function makeDeps(
  rows: FakeDiscoveryPropertyRow[],
  opts: {
    failEnqueue?: boolean
    batchSize?: number
    maxBatches?: number
    intervalMs?: number
  } = {},
) {
  const discoveryRepo = createFakeReviewDiscoveryRepository(rows)
  const findSpy = vi.spyOn(discoveryRepo, 'findDuePropertiesBatch')
  const enqueued: SyncPropertyReviewsJobData[] = []
  const queue: ReviewQueuePort = {
    addSyncJob: async (data) => {
      if (opts.failEnqueue) throw new Error('Redis down')
      enqueued.push(data)
    },
  }
  const handler = createDiscoverNewReviewsHandler({
    discoveryRepo,
    queue,
    clock: () => NOW,
    batchSize: opts.batchSize ?? 2,
    maxBatches: opts.maxBatches ?? 10,
    ...(opts.intervalMs === undefined ? {} : { intervalMs: opts.intervalMs }),
  })
  return { handler, discoveryRepo, enqueued, findSpy, rows }
}

describe('discover-new-reviews sweep', () => {
  it('enqueues a sync job for a connected property with zero stored reviews', async () => {
    const { handler, enqueued } = makeDeps([prop(1)])

    await handler({} as never)

    expect(enqueued).toEqual([
      {
        propertyId: 'aa000000-0000-4000-8000-000000000001',
        organizationId: 'org-1',
        connectionId: 'bb000000-0000-4000-8000-000000000001',
        locationName: expectedLocationName(1),
        initiator: { kind: 'system', id: 'sweep:review-discovery' },
        correlationId: 'review-discovery:aa000000-0000-4000-8000-000000000001',
      },
    ])
  })

  it('skips properties that are not Google-connected or not active', async () => {
    const { handler, enqueued } = makeDeps([
      prop(1, { googleBindingState: 'unbound', connectionId: null, gbpAccountId: null }),
      prop(2, { googleBindingState: 'disconnected' }),
      prop(3, { lifecycleState: 'suspended' }),
      prop(4, { deletedAt: NOW }),
      prop(5, { connectionStatus: 'reauth_required' }),
      prop(6, { credentialUseState: 'cleanup_only' }),
      prop(7),
    ])

    await handler({} as never)

    expect(enqueued.map((d) => d.propertyId)).toEqual([
      'aa000000-0000-4000-8000-000000000007',
    ])
  })

  it('skips properties whose next poll is not yet due and includes elapsed ones', async () => {
    const { handler, enqueued } = makeDeps([
      prop(1, { nextDueAt: new Date(NOW.getTime() + MINUTE) }),
      prop(2, { nextDueAt: new Date(NOW.getTime() - MINUTE) }),
      prop(3, { nextDueAt: NOW }),
    ])

    await handler({} as never)

    expect(enqueued.map((d) => d.propertyId)).toEqual([
      'aa000000-0000-4000-8000-000000000002',
      'aa000000-0000-4000-8000-000000000003',
    ])
  })

  it('advances a recently active property by the configured base interval', async () => {
    const { handler, rows } = makeDeps([prop(1, { lastNewReviewAt: NOW })], {
      intervalMs: 30 * MINUTE,
    })

    await handler({} as never)

    expect(rows[0].nextDueAt).toEqual(new Date(NOW.getTime() + 30 * MINUTE))
    expect(rows[0].lastSuccessAt).toEqual(NOW)
    expect(rows[0].errorClass).toBeNull()
  })

  it('defaults the hot per-property interval to 15 minutes', async () => {
    const { handler, rows } = makeDeps([prop(1, { lastNewReviewAt: NOW })])

    await handler({} as never)

    expect(DEFAULT_DISCOVERY_INTERVAL_MS).toBe(15 * MINUTE)
    expect(rows[0].nextDueAt).toEqual(
      new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
    )
  })

  it('prices each property on its own ladder rung in a single sweep', async () => {
    const DAY = 24 * 60 * MINUTE
    const { handler, rows } = makeDeps(
      [
        // Produced a review minutes ago → hot.
        prop(1, { lastNewReviewAt: new Date(NOW.getTime() - 5 * MINUTE) }),
        // Last review 12 hours ago → warm.
        prop(2, { lastNewReviewAt: new Date(NOW.getTime() - 12 * 60 * MINUTE) }),
        // Connected a month ago, never produced a review → cold.
        prop(3, { observedSince: new Date(NOW.getTime() - 30 * DAY) }),
        // Same month-long silence, but a push just arrived → hot again.
        prop(4, {
          observedSince: new Date(NOW.getTime() - 30 * DAY),
          lastNotificationAt: NOW,
        }),
      ],
      { batchSize: 10 },
    )

    await handler({} as never)

    expect(rows.map((row) => row.nextDueAt)).toEqual([
      new Date(NOW.getTime() + 15 * MINUTE),
      new Date(NOW.getTime() + 60 * MINUTE),
      new Date(NOW.getTime() + 6 * 60 * MINUTE),
      new Date(NOW.getTime() + 15 * MINUTE),
    ])
  })

  it('excludes a property with an in-flight GBP import and includes it once the import settles', async () => {
    const importing = prop(1, { importInFlight: true })
    const { handler, enqueued } = makeDeps([importing, prop(2)], { batchSize: 10 })

    await handler({} as never)
    expect(enqueued.map((d) => d.propertyId)).toEqual([
      'aa000000-0000-4000-8000-000000000002',
    ])

    importing.importInFlight = false
    importing.nextDueAt = null
    enqueued.length = 0
    await handler({} as never)
    expect(enqueued.map((d) => d.propertyId)).toContain(
      'aa000000-0000-4000-8000-000000000001',
    )
  })

  it('advances the keyset cursor between bounded batches', async () => {
    const { handler, enqueued, findSpy } = makeDeps([prop(1), prop(2), prop(3)], {
      batchSize: 2,
    })

    await handler({} as never)

    expect(enqueued).toHaveLength(3)
    expect(findSpy.mock.calls[0]?.[1]).toBeNull()
    expect(findSpy.mock.calls[1]?.[1]).toBe('aa000000-0000-4000-8000-000000000002')
  })

  it('respects the batch budget and leaves the rest for the next firing', async () => {
    const { handler, enqueued, findSpy } = makeDeps([prop(1), prop(2), prop(3)], {
      batchSize: 1,
      maxBatches: 2,
    })

    await handler({} as never)

    expect(enqueued).toHaveLength(2)
    expect(findSpy).toHaveBeenCalledTimes(2)
  })

  it('failed enqueue → holds the cursor, records the failure, and rethrows', async () => {
    const { handler, enqueued, findSpy, rows } = makeDeps([prop(1), prop(2), prop(3)], {
      batchSize: 1,
      failEnqueue: true,
    })

    await expect(handler({} as never)).rejects.toThrow(/cursor held/)

    // Stopped at the failing batch: no second page was requested.
    expect(findSpy).toHaveBeenCalledTimes(1)
    expect(enqueued).toHaveLength(0)
    // The failing property is deferred (recorded, not silently retried
    // forever at the head of every batch) and never marked successful.
    expect(rows[0].errorClass).toBe('enqueue_failed')
    expect(rows[0].lastSuccessAt).toBeNull()
    expect(rows[0].nextDueAt).toEqual(
      new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
    )
    // Later properties were never touched — the cursor never advanced.
    expect(rows[1].nextDueAt).toBeNull()
  })

  it('does nothing when no property is due', async () => {
    const { handler, enqueued, findSpy } = makeDeps([
      prop(1, { nextDueAt: new Date(NOW.getTime() + MINUTE) }),
    ])

    await handler({} as never)

    expect(enqueued).toHaveLength(0)
    expect(findSpy).toHaveBeenCalledTimes(1)
  })
})
