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
        locationName: 'accounts/1234567890/locations/location-1',
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

  it('advances each enqueued property by the configured interval', async () => {
    const { handler, rows } = makeDeps([prop(1)], { intervalMs: 30 * MINUTE })

    await handler({} as never)

    expect(rows[0].nextDueAt).toEqual(new Date(NOW.getTime() + 30 * MINUTE))
    expect(rows[0].lastSuccessAt).toEqual(NOW)
    expect(rows[0].errorClass).toBeNull()
  })

  it('defaults the per-property interval to 15 minutes', async () => {
    const { handler, rows } = makeDeps([prop(1)])

    await handler({} as never)

    expect(DEFAULT_DISCOVERY_INTERVAL_MS).toBe(15 * MINUTE)
    expect(rows[0].nextDueAt).toEqual(
      new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
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
