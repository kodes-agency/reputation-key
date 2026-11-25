// Unit tests for the new-review discovery sweep.
//
// Proves the ingestion hole this job closes: a CONNECTED property with zero
// stored reviews (which the refresh sweep can never see) gets a
// sync-property-reviews job. Plus the sweep contract: candidate filtering,
// per-property due-time filtering and advance, bounded batches, and
// enqueue-failure semantics (cursor held, failure recorded, rethrown).

import { describe, it, expect } from 'vitest'
import { setupDiscoveryDb } from '#/shared/testing/review-discovery-fixtures'
import { createReviewDiscoveryRepository } from './review-discovery-repository.server'
import { createHash } from 'node:crypto'
import {
  DISCOVERY_ORG,
  discoveryProperty,
  type DiscoveryPropertyFixture,
} from '#/shared/testing/review-discovery-fixtures'
import { DEFAULT_DISCOVERY_INTERVAL_MS } from './discover-new-reviews-job.server'
import {
  DISCOVERY_SPREAD_WINDOW_MS,
  DISCOVERY_SWEEP_CADENCE_MS,
} from '../domain/discovery-spread'
import {
  MINUTE,
  NOW,
  expectedLocationName,
  prop,
  sweepHarness,
} from './discover-new-reviews-job.test-fixtures'

const discoveryDb = setupDiscoveryDb(createReviewDiscoveryRepository)
const { makeDeps, stored } = sweepHarness(discoveryDb)

describe('discover-new-reviews sweep', () => {
  it('enqueues a sync job for a connected property with zero stored reviews', async () => {
    const { handler, enqueued } = await makeDeps([prop(1)])

    await handler({} as never)

    expect(enqueued).toEqual([
      {
        propertyId: 'aa000000-0000-4000-8000-000000000001',
        organizationId: DISCOVERY_ORG,
        connectionId: 'bb000000-0000-4000-8000-000000000001',
        locationName: expectedLocationName(1),
        initiator: { kind: 'system', id: 'sweep:review-discovery' },
        correlationId: 'review-discovery:aa000000-0000-4000-8000-000000000001',
      },
    ])
  })

  it('skips properties that are not Google-connected or not active', async () => {
    const { handler, enqueued } = await makeDeps([
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
    const { handler, enqueued } = await makeDeps([
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
    const { handler, rows } = await makeDeps([prop(1, { lastNewReviewAt: NOW })], {
      intervalMs: 30 * MINUTE,
    })

    await handler({} as never)

    expect((await stored(rows[0])).nextDueAt).toEqual(
      new Date(NOW.getTime() + 30 * MINUTE),
    )
    expect((await stored(rows[0])).lastSuccessAt).toEqual(NOW)
    expect((await stored(rows[0])).errorClass).toBeNull()
  })

  it('defaults the hot per-property interval to 15 minutes', async () => {
    const { handler, rows } = await makeDeps([prop(1, { lastNewReviewAt: NOW })])

    await handler({} as never)

    expect(DEFAULT_DISCOVERY_INTERVAL_MS).toBe(15 * MINUTE)
    expect((await stored(rows[0])).nextDueAt).toEqual(
      new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
    )
  })

  it('prices each property on its own ladder rung in a single sweep', async () => {
    const DAY = 24 * 60 * MINUTE
    const { handler, rows } = await makeDeps(
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

    expect(
      await Promise.all(rows.map(async (row) => (await stored(row)).nextDueAt)),
    ).toEqual([
      new Date(NOW.getTime() + 15 * MINUTE),
      new Date(NOW.getTime() + 60 * MINUTE),
      new Date(NOW.getTime() + 6 * 60 * MINUTE),
      new Date(NOW.getTime() + 15 * MINUTE),
    ])
  })

  it('excludes a property with an in-flight GBP import and includes it once the import settles', async () => {
    const importing = prop(1, { importInFlight: true })
    const { handler, enqueued } = await makeDeps([importing, prop(2)], { batchSize: 10 })

    await handler({} as never)
    expect(enqueued.map((d) => d.propertyId)).toEqual([
      'aa000000-0000-4000-8000-000000000002',
    ])

    await discoveryDb.settleImport(importing.propertyId)
    enqueued.length = 0
    await handler({} as never)
    expect(enqueued.map((d) => d.propertyId)).toContain(
      'aa000000-0000-4000-8000-000000000001',
    )
  })

  it('advances the keyset cursor between bounded batches', async () => {
    const { handler, enqueued, findSpy } = await makeDeps([prop(1), prop(2), prop(3)], {
      batchSize: 2,
    })

    await handler({} as never)

    expect(enqueued).toHaveLength(3)
    expect(findSpy.mock.calls[0]?.[1]).toBeNull()
    expect(findSpy.mock.calls[1]?.[1]).toBe('aa000000-0000-4000-8000-000000000002')
  })

  it('respects the batch budget and leaves the rest for the next firing', async () => {
    const { handler, enqueued, findSpy } = await makeDeps([prop(1), prop(2), prop(3)], {
      batchSize: 1,
      maxBatches: 2,
    })

    await handler({} as never)

    expect(enqueued).toHaveLength(2)
    expect(findSpy).toHaveBeenCalledTimes(2)
  })

  it('failed enqueue → holds the cursor, records the failure, and rethrows', async () => {
    const { handler, enqueued, findSpy, rows } = await makeDeps(
      [prop(1), prop(2), prop(3)],
      {
        batchSize: 1,
        failEnqueue: true,
      },
    )

    await expect(handler({} as never)).rejects.toThrow(/cursor held/)

    // Stopped at the failing batch: no second page was requested.
    expect(findSpy).toHaveBeenCalledTimes(1)
    expect(enqueued).toHaveLength(0)
    // The failing property is deferred (recorded, not silently retried
    // forever at the head of every batch) and never marked successful.
    expect((await stored(rows[0])).errorClass).toBe('enqueue_failed')
    expect((await stored(rows[0])).lastSuccessAt).toBeNull()
    expect((await stored(rows[0])).nextDueAt).toEqual(
      new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
    )
    // Later properties were never touched — the cursor never advanced.
    expect((await stored(rows[1])).nextDueAt).toBeNull()
  })

  it('does nothing when no property is due', async () => {
    const { handler, enqueued, findSpy } = await makeDeps([
      prop(1, { nextDueAt: new Date(NOW.getTime() + MINUTE) }),
    ])

    await handler({} as never)

    expect(enqueued).toHaveLength(0)
    expect(findSpy).toHaveBeenCalledTimes(1)
  })
})

// The sweep used to enqueue every due property in the same second, so a
// connection with many properties spent its per-minute reviews.list quota in
// one burst. The jobs are now handed to the queue with a stable per-property
// start delay, inside a window shorter than the sweep's own cadence.
describe('discover-new-reviews sweep: spreading start times', () => {
  // Random-looking ids, like production uuids; sequential literals would not
  // exercise the spread.
  const crowd = (count: number): DiscoveryPropertyFixture[] =>
    Array.from({ length: count }, (_, i) => {
      const hex = createHash('sha256').update(`spread-${i}`).digest('hex')
      return discoveryProperty({
        propertyId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
        connectionId: `bb000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        gbpLocationId: `location-${i}`,
        // Active just now: the hot rung, so the next due time is the base interval.
        lastNewReviewAt: NOW,
      })
    })

  /** Start delay handed to the queue for each enqueued job, in enqueue order. */
  const startDelays = (result: Awaited<ReturnType<typeof makeDeps>>): number[] =>
    result.enqueuedOptions.map((options) => options?.delayMs ?? 0)

  const delayOf = (
    result: Awaited<ReturnType<typeof makeDeps>>,
    propertyId: string,
  ): number => {
    const index = result.enqueued.findIndex((d) => d.propertyId === propertyId)
    return result.enqueuedOptions[index]?.delayMs ?? 0
  }

  it('hands each property to the queue with a start delay inside the spread window', async () => {
    const deps = await makeDeps(crowd(23), { batchSize: 50 })

    await deps.handler({} as never)

    expect(deps.enqueued).toHaveLength(23)
    const delays = startDelays(deps)
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(0)
      expect(delay).toBeLessThan(DISCOVERY_SPREAD_WINDOW_MS)
    }
    // Not all at once: the starts are spread over most of the window.
    expect(new Set(delays).size).toBeGreaterThan(20)
    expect(Math.max(...delays) - Math.min(...delays)).toBeGreaterThan(
      DISCOVERY_SPREAD_WINDOW_MS / 2,
    )
  })

  it('gives a property the same delay on every sweep', async () => {
    const rows = crowd(5)
    const first = await makeDeps(rows, { batchSize: 50 })
    await first.handler({} as never)
    const firstDelays = first.enqueued.map((d) => delayOf(first, d.propertyId))
    expect(Math.max(...firstDelays)).toBeGreaterThan(0)

    // Same properties, due again.
    for (const row of rows) await discoveryDb.clearDueTime(row.propertyId)
    const second = await makeDeps(rows, { batchSize: 50 })
    await second.handler({} as never)
    const secondDelays = second.enqueued.map((d) => delayOf(second, d.propertyId))

    expect(secondDelays).toEqual(firstDelays)
  })

  it('leaves the per-property due time exactly where the ladder priced it', async () => {
    const deps = await makeDeps(crowd(8), { batchSize: 50 })

    await deps.handler({} as never)

    // The delay moves when the job starts, never when the property is next
    // due: a delayed start must not push a property past the next sweep.
    expect(Math.max(...startDelays(deps))).toBeGreaterThan(0)
    for (const row of deps.rows) {
      expect((await stored(row)).nextDueAt).toEqual(
        new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
      )
    }
  })

  it('cannot re-enqueue a property while its previous job is still waiting', async () => {
    let current = NOW
    const deps = await makeDeps(crowd(6), { batchSize: 50, clock: () => current })

    await deps.handler({} as never)
    const firstSweep = deps.enqueued.length
    const longestWait = Math.max(...startDelays(deps))
    expect(longestWait).toBeGreaterThan(0)

    // One millisecond before the property is due again: nothing is enqueued.
    current = new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS - 1)
    await deps.handler({} as never)
    expect(deps.enqueued).toHaveLength(firstSweep)

    // The earliest instant the next sweep may enqueue it again is after the
    // longest delay the first sweep handed out, so the earlier job has
    // already been promoted: the delay never overlaps the next cycle.
    expect(longestWait).toBeLessThan(DEFAULT_DISCOVERY_INTERVAL_MS)
    current = new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS)
    await deps.handler({} as never)
    expect(deps.enqueued).toHaveLength(firstSweep * 2)
  })

  it('keeps the window strictly shorter than a base interval the operator shortened', async () => {
    const deps = await makeDeps(crowd(30), { batchSize: 50, intervalMs: 5 * MINUTE })

    await deps.handler({} as never)

    const delays = startDelays(deps)
    expect(Math.max(...delays)).toBeGreaterThan(0)
    for (const delay of delays) expect(delay).toBeLessThan(5 * MINUTE)
  })

  it('keeps the window strictly shorter than the sweep cadence, even when asked for more', async () => {
    const deps = await makeDeps(crowd(30), {
      batchSize: 50,
      intervalMs: 24 * 60 * MINUTE,
      spreadWindowMs: 3 * 60 * MINUTE,
    })

    await deps.handler({} as never)

    const delays = startDelays(deps)
    expect(Math.max(...delays)).toBeGreaterThan(0)
    for (const delay of delays) expect(delay).toBeLessThan(DISCOVERY_SWEEP_CADENCE_MS)
  })

  it('does not delay anything when the spread window is switched off', async () => {
    const deps = await makeDeps(crowd(5), { batchSize: 50, spreadWindowMs: 0 })

    await deps.handler({} as never)

    expect(deps.enqueued).toHaveLength(5)
    // Not even `delayMs: 0`: the job options stay exactly what they were.
    expect(deps.enqueuedOptions.every((options) => options === undefined)).toBe(true)
  })

  it('never sets a job id, so the queue-level behaviour of a sweep job is unchanged', async () => {
    const deps = await makeDeps(crowd(5), { batchSize: 50 })

    await deps.handler({} as never)

    expect(startDelays(deps).some((delay) => delay > 0)).toBe(true)
    for (const options of deps.enqueuedOptions) expect(options?.jobId).toBeUndefined()
  })
})
