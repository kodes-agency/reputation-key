// Unit tests for the new-review discovery sweep.
//
// Proves the ingestion hole this job closes: a CONNECTED property with zero
// stored reviews (which the refresh sweep can never see) gets a
// sync-property-reviews job. Plus the sweep contract: candidate filtering,
// per-property due-time filtering and advance, bounded batches, and
// enqueue-failure semantics (cursor held, failure recorded, rethrown).

import { createHash } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import type {
  AddSyncJobOptions,
  ReviewHeadCheckJobData,
  ReviewHeadCheckQueuePort,
  ReviewQueuePort,
  SyncPropertyReviewsJobData,
} from '../../application/ports/review-queue.port'
import { headCheckJobId, type ReviewHeadChecksMode } from '../../domain/head-check'
import {
  DISCOVERY_SPREAD_WINDOW_MS,
  DISCOVERY_SWEEP_CADENCE_MS,
} from '../../domain/discovery-spread'
import {
  createFakeReviewDiscoveryRepository,
  fakeDiscoveryProperty,
  type FakeDiscoveryPropertyRow,
} from '#/shared/testing/fake-review-discovery-repository'
import {
  createDiscoverNewReviewsHandler,
  DEFAULT_DISCOVERY_INTERVAL_MS,
} from './discover-new-reviews.job'

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
    spreadWindowMs?: number
    clock?: () => Date
    skipRecentlyReconciled?: boolean
  } = {},
) {
  const discoveryRepo = createFakeReviewDiscoveryRepository(rows)
  const findSpy = vi.spyOn(discoveryRepo, 'findDuePropertiesBatch')
  const enqueued: SyncPropertyReviewsJobData[] = []
  const enqueuedOptions: (AddSyncJobOptions | undefined)[] = []
  const queue: ReviewQueuePort = {
    addSyncJob: async (data, options) => {
      if (opts.failEnqueue) throw new Error('Redis down')
      enqueued.push(data)
      enqueuedOptions.push(options)
    },
  }
  const logger = { info: vi.fn(), warn: vi.fn() }
  const handler = createDiscoverNewReviewsHandler({
    discoveryRepo,
    queue,
    clock: opts.clock ?? (() => NOW),
    logger,
    batchSize: opts.batchSize ?? 2,
    maxBatches: opts.maxBatches ?? 10,
    ...(opts.intervalMs === undefined ? {} : { intervalMs: opts.intervalMs }),
    ...(opts.spreadWindowMs === undefined ? {} : { spreadWindowMs: opts.spreadWindowMs }),
    skipRecentlyReconciled: opts.skipRecentlyReconciled ?? true,
  })
  return { handler, discoveryRepo, enqueued, enqueuedOptions, findSpy, rows, logger }
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

// The sweep used to enqueue every due property in the same second, so a
// connection with many properties spent its per-minute reviews.list quota in
// one burst. The jobs are now handed to the queue with a stable per-property
// start delay, inside a window shorter than the sweep's own cadence.
describe('discover-new-reviews sweep: spreading start times', () => {
  // Random-looking ids, like production uuids; sequential literals would not
  // exercise the spread.
  const crowd = (count: number): FakeDiscoveryPropertyRow[] =>
    Array.from({ length: count }, (_, i) => {
      const hex = createHash('sha256').update(`spread-${i}`).digest('hex')
      return fakeDiscoveryProperty({
        propertyId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
        connectionId: `bb000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        gbpLocationId: `location-${i}`,
        // Active just now: the hot rung, so the next due time is the base interval.
        lastNewReviewAt: NOW,
      })
    })

  /** Start delay handed to the queue for each enqueued job, in enqueue order. */
  const startDelays = (result: ReturnType<typeof makeDeps>): number[] =>
    result.enqueuedOptions.map((options) => options?.delayMs ?? 0)

  const delayOf = (result: ReturnType<typeof makeDeps>, propertyId: string): number => {
    const index = result.enqueued.findIndex((d) => d.propertyId === propertyId)
    return result.enqueuedOptions[index]?.delayMs ?? 0
  }

  it('hands each property to the queue with a start delay inside the spread window', async () => {
    const deps = makeDeps(crowd(23), { batchSize: 50 })

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
    const first = makeDeps(rows, { batchSize: 50 })
    await first.handler({} as never)
    const firstDelays = first.enqueued.map((d) => delayOf(first, d.propertyId))
    expect(Math.max(...firstDelays)).toBeGreaterThan(0)

    // Same properties, due again.
    const second = makeDeps(
      rows.map((row) => ({ ...row, nextDueAt: null })),
      { batchSize: 50 },
    )
    await second.handler({} as never)
    const secondDelays = second.enqueued.map((d) => delayOf(second, d.propertyId))

    expect(secondDelays).toEqual(firstDelays)
  })

  it('leaves the per-property due time exactly where the ladder priced it', async () => {
    const deps = makeDeps(crowd(8), { batchSize: 50 })

    await deps.handler({} as never)

    // The delay moves when the job starts, never when the property is next
    // due: a delayed start must not push a property past the next sweep.
    expect(Math.max(...startDelays(deps))).toBeGreaterThan(0)
    for (const row of deps.rows) {
      expect(row.nextDueAt).toEqual(
        new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
      )
    }
  })

  it('cannot re-enqueue a property while its previous job is still waiting', async () => {
    let current = NOW
    const deps = makeDeps(crowd(6), { batchSize: 50, clock: () => current })

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
    const deps = makeDeps(crowd(30), { batchSize: 50, intervalMs: 5 * MINUTE })

    await deps.handler({} as never)

    const delays = startDelays(deps)
    expect(Math.max(...delays)).toBeGreaterThan(0)
    for (const delay of delays) expect(delay).toBeLessThan(5 * MINUTE)
  })

  it('keeps the window strictly shorter than the sweep cadence, even when asked for more', async () => {
    const deps = makeDeps(crowd(30), {
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
    const deps = makeDeps(crowd(5), { batchSize: 50, spreadWindowMs: 0 })

    await deps.handler({} as never)

    expect(deps.enqueued).toHaveLength(5)
    // Not even `delayMs: 0`: the job options stay exactly what they were.
    expect(deps.enqueuedOptions.every((options) => options === undefined)).toBe(true)
  })

  it('never sets a job id, so the queue-level behaviour of a sweep job is unchanged', async () => {
    const deps = makeDeps(crowd(5), { batchSize: 50 })

    await deps.handler({} as never)

    expect(startDelays(deps).some((delay) => delay > 0)).toBe(true)
    for (const options of deps.enqueuedOptions) expect(options?.jobId).toBeUndefined()
  })
})

// ADR 0055 decision 5 only asks that a quiet healthy Property is reconciled
// within six hours. A look that finds a COMPLETED reconciliation inside that
// window writes the next look's date and enqueues nothing.
describe('discover-new-reviews sweep: skipping a recently reconciled Property', () => {
  const HOUR = 60 * MINUTE
  const ago = (ms: number) => new Date(NOW.getTime() - ms)
  const HOT = { lastNewReviewAt: NOW }

  /** The "sweep finished" log payload of the first (only) run. */
  const finishedLog = (result: ReturnType<typeof makeDeps>): Record<string, unknown> => {
    const call = result.logger.info.mock.calls.find(
      ([, message]) => message === 'Discover new reviews sweep finished',
    )
    return (call?.[0] ?? {}) as Record<string, unknown>
  }

  it('enqueues nothing for a hot Property reconciled an hour ago, and writes one wake-up', async () => {
    const reconciled = ago(HOUR)
    const deps = makeDeps([prop(1, { ...HOT, lastReconciledAt: reconciled })])

    await deps.handler({} as never)

    expect(deps.enqueued).toHaveLength(0)
    expect(deps.rows.at(0)?.nextDueAt).toEqual(
      new Date(reconciled.getTime() + 6 * HOUR - DEFAULT_DISCOVERY_INTERVAL_MS),
    )
  })

  it('leaves the success stamp and the failure state alone when it skips', async () => {
    const stamp = ago(3 * HOUR)
    const deps = makeDeps([
      prop(1, { ...HOT, lastReconciledAt: ago(HOUR), lastSuccessAt: stamp }),
    ])

    await deps.handler({} as never)

    expect(deps.rows.at(0)?.lastSuccessAt).toEqual(stamp)
    expect(deps.rows.at(0)?.errorClass).toBeNull()
    expect(deps.rows.at(0)?.errorRetryAt).toBeNull()
  })

  it('never defers the Property: a skip is not a failure', async () => {
    const deps = makeDeps([prop(1, { ...HOT, lastReconciledAt: ago(HOUR) })])
    const deferred = vi.spyOn(deps.discoveryRepo, 'markDiscoveryDeferred')
    const scheduled = vi.spyOn(deps.discoveryRepo, 'markDiscoveryScheduled')
    const skipped = vi.spyOn(deps.discoveryRepo, 'markDiscoverySkipped')

    await deps.handler({} as never)

    expect(deferred).not.toHaveBeenCalled()
    expect(scheduled).not.toHaveBeenCalled()
    expect(skipped).toHaveBeenCalledTimes(1)
  })

  it('skips a warm Property reconciled an hour ago', async () => {
    const deps = makeDeps([
      prop(1, {
        lastNewReviewAt: ago(12 * HOUR),
        lastReconciledAt: ago(HOUR),
      }),
    ])

    await deps.handler({} as never)

    expect(deps.enqueued).toHaveLength(0)
  })

  it('always runs a cold look in full: its interval already reaches the deadline', async () => {
    const deps = makeDeps([
      prop(1, {
        observedSince: ago(30 * 24 * HOUR),
        lastReconciledAt: ago(MINUTE),
      }),
    ])

    await deps.handler({} as never)

    expect(deps.enqueued).toHaveLength(1)
    expect(deps.rows.at(0)?.nextDueAt).toEqual(new Date(NOW.getTime() + 6 * HOUR))
  })

  it('runs in full, exactly as before, when the Property has never completed a reconciliation', async () => {
    const deps = makeDeps([prop(1, { ...HOT, lastReconciledAt: null })])

    await deps.handler({} as never)

    expect(deps.enqueued).toHaveLength(1)
    expect(deps.rows.at(0)?.lastSuccessAt).toEqual(NOW)
    expect(deps.rows.at(0)?.nextDueAt).toEqual(
      new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
    )
  })

  it('runs in full while a failure waits for its retry, so the retry still happens', async () => {
    const deps = makeDeps([
      prop(1, {
        ...HOT,
        lastReconciledAt: ago(MINUTE),
        errorClass: 'provider_failure',
        errorRetryAt: ago(MINUTE),
      }),
    ])

    await deps.handler({} as never)

    expect(deps.enqueued).toHaveLength(1)
  })

  it('leaves a failed Property alone until its backoff retry date, then retries it in full', async () => {
    const retryAt = new Date(NOW.getTime() + 4 * HOUR)
    const deps = makeDeps([
      prop(1, {
        ...HOT,
        lastReconciledAt: ago(MINUTE),
        errorClass: 'provider_failure',
        errorRetryAt: retryAt,
        lastFailureAt: NOW,
        nextDueAt: retryAt,
      }),
    ])

    await deps.handler({} as never)
    expect(deps.enqueued).toEqual([])

    const later = makeDeps(deps.rows, { clock: () => retryAt })
    await later.handler({} as never)
    expect(later.enqueued).toHaveLength(1)
  })

  it('runs in full when the next look would land at the six-hour deadline, and skips one millisecond earlier', async () => {
    // now + interval == L + 6h  →  L = NOW - (6h - 15m)
    const atBoundary = ago(6 * HOUR - DEFAULT_DISCOVERY_INTERVAL_MS)
    const justInside = new Date(atBoundary.getTime() + 1)
    const deps = makeDeps(
      [
        prop(1, { ...HOT, lastReconciledAt: atBoundary }),
        prop(2, { ...HOT, lastReconciledAt: justInside }),
      ],
      { batchSize: 10 },
    )

    await deps.handler({} as never)

    expect(deps.enqueued.map((d) => d.propertyId)).toEqual([
      'aa000000-0000-4000-8000-000000000001',
    ])
  })

  it('wakes at the moment the look becomes full, and enqueues then', async () => {
    let current = NOW
    const reconciled = ago(HOUR)
    const deps = makeDeps([prop(1, { ...HOT, lastReconciledAt: reconciled })], {
      clock: () => current,
    })

    await deps.handler({} as never)
    expect(deps.enqueued).toHaveLength(0)
    const wakeUp = deps.rows.at(0)?.nextDueAt as Date

    // One millisecond before the wake-up: not due, nothing happens.
    current = new Date(wakeUp.getTime() - 1)
    await deps.handler({} as never)
    expect(deps.enqueued).toHaveLength(0)

    current = wakeUp
    await deps.handler({} as never)
    expect(deps.enqueued).toHaveLength(1)
  })

  it('does not delay or reshape a full look in a mixed batch', async () => {
    const deps = makeDeps(
      [
        prop(1, { ...HOT, lastReconciledAt: ago(HOUR) }),
        prop(2, { ...HOT, lastReconciledAt: null }),
        prop(3, { ...HOT, lastReconciledAt: ago(HOUR) }),
      ],
      { batchSize: 2 },
    )

    await deps.handler({} as never)

    expect(deps.enqueued.map((d) => d.propertyId)).toEqual([
      'aa000000-0000-4000-8000-000000000002',
    ])
    // The cursor moved past the skipped rows: the second batch saw property 3.
    expect(deps.findSpy.mock.calls[1]?.[1]).toBe('aa000000-0000-4000-8000-000000000002')
    expect(deps.rows.at(1)?.nextDueAt).toEqual(
      new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
    )
  })

  it('counts a skipped Property against the sweep budget but leaves it out of the next sweep', async () => {
    const deps = makeDeps(
      [
        prop(1, { ...HOT, lastReconciledAt: ago(HOUR) }),
        prop(2, { ...HOT, lastReconciledAt: ago(HOUR) }),
        prop(3, { ...HOT, lastReconciledAt: null }),
      ],
      { batchSize: 1, maxBatches: 2 },
    )

    await deps.handler({} as never)
    expect(finishedLog(deps).candidatesSeen).toBe(2)
    expect(deps.enqueued).toHaveLength(0)

    // Both skipped Properties left the due set, so the next sweep reaches 3.
    await deps.handler({} as never)
    expect(deps.enqueued.map((d) => d.propertyId)).toEqual([
      'aa000000-0000-4000-8000-000000000003',
    ])
  })

  it('does not skip at all when the switch is off', async () => {
    const deps = makeDeps([prop(1, { ...HOT, lastReconciledAt: ago(MINUTE) })], {
      skipRecentlyReconciled: false,
    })

    await deps.handler({} as never)

    expect(deps.enqueued).toHaveLength(1)
    expect(deps.rows.at(0)?.lastSuccessAt).toEqual(NOW)
    expect(finishedLog(deps)).toMatchObject({ skipped: 0, fullSkipDisabled: 1 })
  })

  it('keeps every look full when the caller omits the skip dependency', async () => {
    const deps = makeDeps([prop(1, { ...HOT, lastReconciledAt: ago(MINUTE) })])
    const omitted = createDiscoverNewReviewsHandler({
      discoveryRepo: createFakeReviewDiscoveryRepository(deps.rows),
      queue: { addSyncJob: async (data) => void deps.enqueued.push(data) },
      clock: () => NOW,
      logger: deps.logger,
      spreadWindowMs: 0,
    })

    await omitted({} as never)

    expect(deps.enqueued).toHaveLength(1)
    expect(finishedLog(deps)).toMatchObject({ skipped: 0, fullSkipDisabled: 1 })
  })

  it('reports skips by tier and full looks by reason in the sweep log, without identifiers', async () => {
    const deps = makeDeps(
      [
        prop(1, { ...HOT, lastReconciledAt: ago(HOUR) }),
        prop(2, { lastNewReviewAt: ago(12 * HOUR), lastReconciledAt: ago(HOUR) }),
        prop(3, { ...HOT, lastReconciledAt: null }),
        prop(4, {
          ...HOT,
          lastReconciledAt: ago(MINUTE),
          errorClass: 'provider_failure',
        }),
        prop(5, { ...HOT, lastReconciledAt: ago(6 * HOUR) }),
      ],
      { batchSize: 10 },
    )

    await deps.handler({} as never)

    const log = finishedLog(deps)
    expect(log).toMatchObject({
      candidatesSeen: 5,
      enqueued: 3,
      skipped: 2,
      skippedHot: 1,
      skippedWarm: 1,
      skippedCold: 0,
      fullSkipDisabled: 0,
      fullFailureRetry: 1,
      fullNoReconciliation: 1,
      fullDue: 1,
    })
    expect(Object.keys(log)).not.toContain('propertyId')
  })

  it('keeps the push-targeted clamp semantics: a clamped look that finds a recent fact skips', async () => {
    // A push clamps next_incremental_at to about now + 15 minutes and stamps
    // last_notification_at; the property is hot and the look lands here.
    const deps = makeDeps([
      prop(1, {
        lastNotificationAt: ago(MINUTE),
        nextDueAt: NOW,
        lastReconciledAt: ago(2 * HOUR),
      }),
    ])

    await deps.handler({} as never)

    expect(deps.enqueued).toHaveLength(0)
  })
})

// With head checks on, a skipped look is not empty: the sweep hands the
// Property a one-call check of Google's newest page and wakes it again at the
// ladder interval, instead of #909's single wake-up near the six-hour deadline.
describe('discover-new-reviews sweep: head checks on skipped looks', () => {
  const HOUR = 60 * MINUTE
  const ago = (ms: number) => new Date(NOW.getTime() - ms)
  const HOT = { lastNewReviewAt: NOW }

  type HeadCall = Readonly<{
    data: ReviewHeadCheckJobData
    options: Parameters<ReviewHeadCheckQueuePort['addHeadCheckJob']>[1]
  }>

  function makeHeadDeps(
    rows: FakeDiscoveryPropertyRow[],
    opts: {
      headChecks?: ReviewHeadChecksMode
      withQueue?: boolean
      failHeadEnqueue?: boolean
      skipRecentlyReconciled?: boolean
      spreadWindowMs?: number
      clock?: () => Date
      batchSize?: number
    } = {},
  ) {
    const discoveryRepo = createFakeReviewDiscoveryRepository(rows)
    const syncJobs: SyncPropertyReviewsJobData[] = []
    const headCalls: HeadCall[] = []
    const headQueue: ReviewHeadCheckQueuePort = {
      addHeadCheckJob: async (data, options) => {
        if (opts.failHeadEnqueue) throw new Error('Redis down')
        headCalls.push({ data, options })
      },
    }
    const logger = { info: vi.fn(), warn: vi.fn() }
    const handler = createDiscoverNewReviewsHandler({
      discoveryRepo,
      queue: { addSyncJob: async (data) => void syncJobs.push(data) },
      clock: opts.clock ?? (() => NOW),
      logger,
      batchSize: opts.batchSize ?? 10,
      spreadWindowMs: opts.spreadWindowMs ?? 0,
      skipRecentlyReconciled: opts.skipRecentlyReconciled ?? true,
      ...(opts.headChecks === undefined ? {} : { headChecks: opts.headChecks }),
      ...(opts.withQueue === false ? {} : { headCheckQueue: headQueue }),
    })
    return { handler, discoveryRepo, rows, syncJobs, headCalls, logger }
  }

  const finishedLog = (result: ReturnType<typeof makeHeadDeps>) =>
    (result.logger.info.mock.calls.find(
      ([, message]) => message === 'Discover new reviews sweep finished',
    )?.[0] ?? {}) as Record<string, unknown>

  it('enqueues a head job for a skipped look and wakes the Property at now + the ladder interval', async () => {
    const deps = makeHeadDeps([prop(1, { ...HOT, lastReconciledAt: ago(HOUR) })], {
      headChecks: 'dark',
    })

    await deps.handler({} as never)

    expect(deps.syncJobs).toHaveLength(0)
    expect(deps.headCalls).toEqual([
      {
        data: {
          mode: 'head',
          propertyId: 'aa000000-0000-4000-8000-000000000001',
          organizationId: 'org-1',
          connectionId: 'bb000000-0000-4000-8000-000000000001',
          locationName: expectedLocationName(1),
          initiator: { kind: 'system', id: 'sweep:review-discovery' },
          correlationId: 'review-head:aa000000-0000-4000-8000-000000000001',
        },
        options: {
          jobId: headCheckJobId(
            'aa000000-0000-4000-8000-000000000001',
            NOW,
            DEFAULT_DISCOVERY_INTERVAL_MS,
          ),
        },
      },
    ])
    expect(deps.rows.at(0)?.nextDueAt).toEqual(
      new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
    )
  })

  it('wakes a warm Property at now + an hour', async () => {
    const deps = makeHeadDeps(
      [prop(1, { lastNewReviewAt: ago(12 * HOUR), lastReconciledAt: ago(HOUR) })],
      { headChecks: 'dark' },
    )

    await deps.handler({} as never)

    expect(deps.headCalls).toHaveLength(1)
    expect(deps.rows.at(0)?.nextDueAt).toEqual(new Date(NOW.getTime() + HOUR))
  })

  it('leaves the success stamp and the failure state alone, as any skip does', async () => {
    const stamp = ago(3 * HOUR)
    const deps = makeHeadDeps(
      [prop(1, { ...HOT, lastReconciledAt: ago(HOUR), lastSuccessAt: stamp })],
      { headChecks: 'dark' },
    )

    await deps.handler({} as never)

    expect(deps.rows.at(0)?.lastSuccessAt).toEqual(stamp)
    expect(deps.rows.at(0)?.errorClass).toBeNull()
  })

  it('leaves every full look alone: no head job beside a snapshot, none for a retry', async () => {
    const deps = makeHeadDeps(
      [
        prop(1, { ...HOT, lastReconciledAt: null }),
        prop(2, {
          ...HOT,
          lastReconciledAt: ago(MINUTE),
          errorClass: 'provider_failure',
        }),
        prop(3, { ...HOT, lastReconciledAt: ago(6 * HOUR) }),
      ],
      { headChecks: 'dark' },
    )

    await deps.handler({} as never)

    expect(deps.syncJobs).toHaveLength(3)
    expect(deps.headCalls).toHaveLength(0)
  })

  it('with head checks off, behaves exactly as before: nothing enqueued, one wake-up near the deadline', async () => {
    const reconciled = ago(HOUR)
    const off = makeHeadDeps([prop(1, { ...HOT, lastReconciledAt: reconciled })], {
      headChecks: 'off',
    })
    const omitted = makeHeadDeps([prop(1, { ...HOT, lastReconciledAt: reconciled })])

    await off.handler({} as never)
    await omitted.handler({} as never)

    for (const deps of [off, omitted]) {
      expect(deps.syncJobs).toHaveLength(0)
      expect(deps.headCalls).toHaveLength(0)
      expect(deps.rows.at(0)?.nextDueAt).toEqual(
        new Date(reconciled.getTime() + 6 * HOUR - DEFAULT_DISCOVERY_INTERVAL_MS),
      )
    }
  })

  it('treats a missing head queue as off rather than waking the Property early for nothing', async () => {
    const reconciled = ago(HOUR)
    const deps = makeHeadDeps([prop(1, { ...HOT, lastReconciledAt: reconciled })], {
      headChecks: 'dark',
      withQueue: false,
    })

    await deps.handler({} as never)

    expect(deps.rows.at(0)?.nextDueAt).toEqual(
      new Date(reconciled.getTime() + 6 * HOUR - DEFAULT_DISCOVERY_INTERVAL_MS),
    )
  })

  it('does not skip, and so does not check, when the skip switch is off', async () => {
    const deps = makeHeadDeps([prop(1, { ...HOT, lastReconciledAt: ago(MINUTE) })], {
      headChecks: 'dark',
      skipRecentlyReconciled: false,
    })

    await deps.handler({} as never)

    expect(deps.syncJobs).toHaveLength(1)
    expect(deps.headCalls).toHaveLength(0)
  })

  it('names one job per Property and interval bucket, so two looks never stack', async () => {
    const later = new Date(NOW.getTime() + 5 * MINUTE)
    const first = makeHeadDeps([prop(1, { ...HOT, lastReconciledAt: ago(HOUR) })], {
      headChecks: 'dark',
    })
    const second = makeHeadDeps([prop(1, { ...HOT, lastReconciledAt: ago(HOUR) })], {
      headChecks: 'dark',
      clock: () => later,
    })

    await first.handler({} as never)
    await second.handler({} as never)

    expect(first.headCalls.at(0)?.options.jobId).toBe(
      second.headCalls.at(0)?.options.jobId,
    )
  })

  it('spreads the starts of a sweep’s head jobs over the same window as its snapshots', async () => {
    const rows = [1, 2, 3, 4, 5].map((n) =>
      prop(n, { ...HOT, lastReconciledAt: ago(HOUR) }),
    )
    const deps = makeHeadDeps(rows, {
      headChecks: 'dark',
      spreadWindowMs: DISCOVERY_SPREAD_WINDOW_MS,
    })

    await deps.handler({} as never)

    const delays = deps.headCalls.map((call) => call.options.delayMs ?? 0)
    expect(delays.some((delay) => delay > 0)).toBe(true)
    expect(Math.max(...delays)).toBeLessThan(DISCOVERY_SWEEP_CADENCE_MS)
  })

  it('does not fail the sweep, hold its cursor or skip the date when a head job cannot be enqueued', async () => {
    const deps = makeHeadDeps(
      [
        prop(1, { ...HOT, lastReconciledAt: ago(HOUR) }),
        prop(2, { ...HOT, lastReconciledAt: ago(HOUR) }),
      ],
      { headChecks: 'dark', failHeadEnqueue: true, batchSize: 1 },
    )

    await expect(deps.handler({} as never)).resolves.toBeUndefined()

    expect(deps.rows.map((row) => row.nextDueAt)).toEqual([
      new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
      new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
    ])
    expect(deps.rows.every((row) => row.errorClass === null)).toBe(true)
    expect(deps.logger.warn).toHaveBeenCalledTimes(2)
    expect(finishedLog(deps)).toMatchObject({
      candidatesSeen: 2,
      skipped: 2,
      headChecksEnqueued: 0,
      headChecksFailed: 2,
    })
  })

  it('counts the head jobs in the sweep log without naming a Property', async () => {
    const deps = makeHeadDeps(
      [
        prop(1, { ...HOT, lastReconciledAt: ago(HOUR) }),
        prop(2, { ...HOT, lastReconciledAt: null }),
      ],
      { headChecks: 'dark' },
    )

    await deps.handler({} as never)

    const log = finishedLog(deps)
    expect(log).toMatchObject({
      skipped: 1,
      enqueued: 1,
      headChecksEnqueued: 1,
      headChecksFailed: 0,
    })
    expect(Object.keys(log)).not.toContain('propertyId')
  })
})
