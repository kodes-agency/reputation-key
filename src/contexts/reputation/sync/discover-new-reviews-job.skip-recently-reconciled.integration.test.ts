// Integration tests for skipping a recently reconciled Property in the new-review discovery sweep.

import { describe, it, expect, vi } from 'vitest'
import { setupDiscoveryDb } from '#/shared/testing/review-discovery-fixtures'
import { createReviewDiscoveryRepository } from './review-discovery-repository.server'
import {
  createDiscoverNewReviewsHandler,
  DEFAULT_DISCOVERY_INTERVAL_MS,
} from './discover-new-reviews-job.server'
import {
  HOT,
  HOUR,
  MINUTE,
  NOW,
  ago,
  finishedLog,
  prop,
  sweepHarness,
} from './discover-new-reviews-job.test-fixtures'

const discoveryDb = setupDiscoveryDb(createReviewDiscoveryRepository)
const { makeDeps, nextDueOf, stored } = sweepHarness(discoveryDb)

// ADR 0055 decision 5 only asks that a quiet healthy Property is reconciled
// within six hours. A look that finds a COMPLETED reconciliation inside that
// window writes the next look's date and enqueues nothing.
describe('discover-new-reviews sweep: skipping a recently reconciled Property', () => {
  it('enqueues nothing for a hot Property reconciled an hour ago, and writes one wake-up', async () => {
    const reconciled = ago(HOUR)
    const deps = await makeDeps([prop(1, { ...HOT, lastReconciledAt: reconciled })])

    await deps.handler({} as never)

    expect(deps.enqueued).toHaveLength(0)
    expect(await nextDueOf(deps)).toEqual(
      new Date(reconciled.getTime() + 6 * HOUR - DEFAULT_DISCOVERY_INTERVAL_MS),
    )
  })

  it('leaves the success stamp and the failure state alone when it skips', async () => {
    const stamp = ago(3 * HOUR)
    const deps = await makeDeps([
      prop(1, { ...HOT, lastReconciledAt: ago(HOUR), lastSuccessAt: stamp }),
    ])

    await deps.handler({} as never)

    expect((await stored(deps.rows[0])).lastSuccessAt).toEqual(stamp)
    expect((await stored(deps.rows[0])).errorClass).toBeNull()
    expect((await stored(deps.rows[0])).errorRetryAt).toBeNull()
  })

  it('never defers the Property: a skip is not a failure', async () => {
    const deps = await makeDeps([prop(1, { ...HOT, lastReconciledAt: ago(HOUR) })])
    const deferred = vi.spyOn(deps.discoveryRepo, 'markDiscoveryDeferred')
    const scheduled = vi.spyOn(deps.discoveryRepo, 'markDiscoveryScheduled')
    const skipped = vi.spyOn(deps.discoveryRepo, 'markDiscoverySkipped')

    await deps.handler({} as never)

    expect(deferred).not.toHaveBeenCalled()
    expect(scheduled).not.toHaveBeenCalled()
    expect(skipped).toHaveBeenCalledTimes(1)
  })

  it('skips a warm Property reconciled an hour ago', async () => {
    const deps = await makeDeps([
      prop(1, {
        lastNewReviewAt: ago(12 * HOUR),
        lastReconciledAt: ago(HOUR),
      }),
    ])

    await deps.handler({} as never)

    expect(deps.enqueued).toHaveLength(0)
  })

  it('always runs a cold look in full: its interval already reaches the deadline', async () => {
    const deps = await makeDeps([
      prop(1, {
        observedSince: ago(30 * 24 * HOUR),
        lastReconciledAt: ago(MINUTE),
      }),
    ])

    await deps.handler({} as never)

    expect(deps.enqueued).toHaveLength(1)
    expect(await nextDueOf(deps)).toEqual(new Date(NOW.getTime() + 6 * HOUR))
  })

  it('runs in full, exactly as before, when the Property has never completed a reconciliation', async () => {
    const deps = await makeDeps([prop(1, { ...HOT, lastReconciledAt: null })])

    await deps.handler({} as never)

    expect(deps.enqueued).toHaveLength(1)
    expect((await stored(deps.rows[0])).lastSuccessAt).toEqual(NOW)
    expect(await nextDueOf(deps)).toEqual(
      new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
    )
  })

  it('runs in full while a failure waits for its retry, so the retry still happens', async () => {
    const deps = await makeDeps([
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
    const deps = await makeDeps([
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

    const later = await makeDeps(deps.rows, { clock: () => retryAt })
    await later.handler({} as never)
    expect(later.enqueued).toHaveLength(1)
  })

  it('runs in full when the next look would land at the six-hour deadline, and skips one millisecond earlier', async () => {
    // now + interval == L + 6h  →  L = NOW - (6h - 15m)
    const atBoundary = ago(6 * HOUR - DEFAULT_DISCOVERY_INTERVAL_MS)
    const justInside = new Date(atBoundary.getTime() + 1)
    const deps = await makeDeps(
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
    const deps = await makeDeps([prop(1, { ...HOT, lastReconciledAt: reconciled })], {
      clock: () => current,
    })

    await deps.handler({} as never)
    expect(deps.enqueued).toHaveLength(0)
    const wakeUp = (await nextDueOf(deps)) as Date

    // One millisecond before the wake-up: not due, nothing happens.
    current = new Date(wakeUp.getTime() - 1)
    await deps.handler({} as never)
    expect(deps.enqueued).toHaveLength(0)

    current = wakeUp
    await deps.handler({} as never)
    expect(deps.enqueued).toHaveLength(1)
  })

  it('does not delay or reshape a full look in a mixed batch', async () => {
    const deps = await makeDeps(
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
    expect((await stored(deps.rows[1])).nextDueAt).toEqual(
      new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
    )
  })

  it('counts a skipped Property against the sweep budget but leaves it out of the next sweep', async () => {
    const deps = await makeDeps(
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
    const deps = await makeDeps([prop(1, { ...HOT, lastReconciledAt: ago(MINUTE) })], {
      skipRecentlyReconciled: false,
    })

    await deps.handler({} as never)

    expect(deps.enqueued).toHaveLength(1)
    expect((await stored(deps.rows[0])).lastSuccessAt).toEqual(NOW)
    expect(finishedLog(deps)).toMatchObject({ skipped: 0, fullSkipDisabled: 1 })
  })

  it('keeps every look full when the caller omits the skip dependency', async () => {
    const deps = await makeDeps([prop(1, { ...HOT, lastReconciledAt: ago(MINUTE) })])
    const omitted = createDiscoverNewReviewsHandler({
      discoveryRepo: discoveryDb.repo(),
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
    const deps = await makeDeps(
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
    const deps = await makeDeps([
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
