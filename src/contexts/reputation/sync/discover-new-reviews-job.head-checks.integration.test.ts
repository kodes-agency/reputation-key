// Integration tests for head checks on skipped looks in the new-review discovery sweep.

import { describe, it, expect } from 'vitest'
import { setupDiscoveryDb } from '#/shared/testing/review-discovery-fixtures'
import { createReviewDiscoveryRepository } from './review-discovery-repository.server'
import { DISCOVERY_ORG } from '#/shared/testing/review-discovery-fixtures'
import {
  DISCOVERY_SPREAD_WINDOW_MS,
  DISCOVERY_SWEEP_CADENCE_MS,
} from '../domain/discovery-spread'
import { headCheckJobId } from '../domain/head-check'
import { DEFAULT_DISCOVERY_INTERVAL_MS } from './discover-new-reviews-job.server'
import {
  HOT,
  HOUR,
  MINUTE,
  NOW,
  ago,
  expectedLocationName,
  finishedLog,
  prop,
  sweepHarness,
} from './discover-new-reviews-job.test-fixtures'

const discoveryDb = setupDiscoveryDb(createReviewDiscoveryRepository)
const { makeHeadDeps, nextDueOf, stored } = sweepHarness(discoveryDb)

// With head checks on, a skipped look is not empty: the sweep hands the
// Property a one-call check of Google's newest page and wakes it again at the
// ladder interval, rather than one wake-up near the six-hour deadline.
describe('discover-new-reviews sweep: head checks on skipped looks', () => {
  it('enqueues a head job for a skipped look and wakes the Property at now + the ladder interval', async () => {
    const deps = await makeHeadDeps([prop(1, { ...HOT, lastReconciledAt: ago(HOUR) })], {
      headChecks: 'dark',
    })

    await deps.handler({} as never)

    expect(deps.syncJobs).toHaveLength(0)
    expect(deps.headCalls).toEqual([
      {
        data: {
          mode: 'head',
          propertyId: 'aa000000-0000-4000-8000-000000000001',
          organizationId: DISCOVERY_ORG,
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
    expect(await nextDueOf(deps)).toEqual(
      new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
    )
  })

  it('wakes a warm Property at now + an hour', async () => {
    const deps = await makeHeadDeps(
      [prop(1, { lastNewReviewAt: ago(12 * HOUR), lastReconciledAt: ago(HOUR) })],
      { headChecks: 'dark' },
    )

    await deps.handler({} as never)

    expect(deps.headCalls).toHaveLength(1)
    expect(await nextDueOf(deps)).toEqual(new Date(NOW.getTime() + HOUR))
  })

  it('leaves the success stamp and the failure state alone, as any skip does', async () => {
    const stamp = ago(3 * HOUR)
    const deps = await makeHeadDeps(
      [prop(1, { ...HOT, lastReconciledAt: ago(HOUR), lastSuccessAt: stamp })],
      { headChecks: 'dark' },
    )

    await deps.handler({} as never)

    expect((await stored(deps.rows[0])).lastSuccessAt).toEqual(stamp)
    expect((await stored(deps.rows[0])).errorClass).toBeNull()
  })

  it('leaves every full look alone: no head job beside a snapshot, none for a retry', async () => {
    const deps = await makeHeadDeps(
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
    const woken = new Date(
      reconciled.getTime() + 6 * HOUR - DEFAULT_DISCOVERY_INTERVAL_MS,
    )
    const off = await makeHeadDeps([prop(1, { ...HOT, lastReconciledAt: reconciled })], {
      headChecks: 'off',
    })
    await off.handler({} as never)
    expect(off.syncJobs).toHaveLength(0)
    expect(off.headCalls).toHaveLength(0)
    expect((await stored(off.rows[0])).nextDueAt).toEqual(woken)

    await discoveryDb.reset()
    const omitted = await makeHeadDeps([
      prop(1, { ...HOT, lastReconciledAt: reconciled }),
    ])
    await omitted.handler({} as never)
    expect(omitted.syncJobs).toHaveLength(0)
    expect(omitted.headCalls).toHaveLength(0)
    expect((await stored(omitted.rows[0])).nextDueAt).toEqual(woken)
  })

  it('follows a skipped look with a head job in persist mode too', async () => {
    const deps = await makeHeadDeps([prop(1, { ...HOT, lastReconciledAt: ago(HOUR) })], {
      headChecks: 'persist',
    })

    await deps.handler({} as never)

    expect(deps.syncJobs).toHaveLength(0)
    expect(deps.headCalls).toHaveLength(1)
    expect(await nextDueOf(deps)).toEqual(
      new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
    )
  })

  it('skips a Property reconciled ten hours ago when the window is twenty-four hours, and a six hour window does not', async () => {
    const widened = await makeHeadDeps(
      [prop(1, { ...HOT, lastReconciledAt: ago(10 * HOUR) })],
      { headChecks: 'persist', reconcileWithinMs: 24 * HOUR },
    )
    await widened.handler({} as never)

    await discoveryDb.reset()
    const standard = await makeHeadDeps(
      [prop(1, { ...HOT, lastReconciledAt: ago(10 * HOUR) })],
      { headChecks: 'persist' },
    )
    await standard.handler({} as never)

    expect(widened.syncJobs).toHaveLength(0)
    expect(widened.headCalls).toHaveLength(1)
    expect(standard.syncJobs).toHaveLength(1)
    expect(standard.headCalls).toHaveLength(0)
  })

  it('passes each Property’s head cover and request to the rule at a weekly window, and logs why looks ran full', async () => {
    const WEEK = 7 * 24 * HOUR
    const deps = await makeHeadDeps(
      [
        // Covered a minute ago, listed two days ago: a head check, no listing.
        prop(1, { ...HOT, lastReconciledAt: ago(48 * HOUR), headCoveredAt: ago(MINUTE) }),
        // No cover: listed in full once the listing is a day old.
        prop(2, {
          ...HOT,
          lastReconciledAt: ago(48 * HOUR),
          headCoveredAt: ago(8 * HOUR),
        }),
        // Covered, but the content refresh asked for a full read after the listing.
        prop(3, {
          ...HOT,
          lastReconciledAt: ago(48 * HOUR),
          headCoveredAt: ago(MINUTE),
          fullReadRequestedAt: ago(HOUR),
        }),
      ],
      { headChecks: 'persist', reconcileWithinMs: WEEK },
    )

    await deps.handler({} as never)

    expect(deps.syncJobs.map((job) => job.propertyId)).toEqual([
      'aa000000-0000-4000-8000-000000000002',
      'aa000000-0000-4000-8000-000000000003',
    ])
    expect(deps.headCalls.map((call) => call.data.propertyId)).toEqual([
      'aa000000-0000-4000-8000-000000000001',
    ])
    expect(finishedLog(deps)).toMatchObject({
      skipped: 1,
      fullDue: 0,
      fullRequested: 1,
      fullUncovered: 1,
    })
  })

  it('ignores head cover at a daily window', async () => {
    const deps = await makeHeadDeps(
      [prop(1, { ...HOT, lastReconciledAt: ago(10 * HOUR), headCoveredAt: null })],
      { headChecks: 'persist', reconcileWithinMs: 24 * HOUR },
    )

    await deps.handler({} as never)

    expect(deps.syncJobs).toHaveLength(0)
    expect(deps.headCalls).toHaveLength(1)
    expect(finishedLog(deps)).toMatchObject({ fullRequested: 0, fullUncovered: 0 })
  })

  it('treats a missing head queue as off rather than waking the Property early for nothing', async () => {
    const reconciled = ago(HOUR)
    const deps = await makeHeadDeps([prop(1, { ...HOT, lastReconciledAt: reconciled })], {
      headChecks: 'dark',
      withQueue: false,
    })

    await deps.handler({} as never)

    expect(await nextDueOf(deps)).toEqual(
      new Date(reconciled.getTime() + 6 * HOUR - DEFAULT_DISCOVERY_INTERVAL_MS),
    )
  })

  it('does not skip, and so does not check, when the skip switch is off', async () => {
    const deps = await makeHeadDeps(
      [prop(1, { ...HOT, lastReconciledAt: ago(MINUTE) })],
      {
        headChecks: 'dark',
        skipRecentlyReconciled: false,
      },
    )

    await deps.handler({} as never)

    expect(deps.syncJobs).toHaveLength(1)
    expect(deps.headCalls).toHaveLength(0)
  })

  it('names one job per Property and interval bucket, so two looks never stack', async () => {
    const later = new Date(NOW.getTime() + 5 * MINUTE)
    const first = await makeHeadDeps([prop(1, { ...HOT, lastReconciledAt: ago(HOUR) })], {
      headChecks: 'dark',
    })
    await first.handler({} as never)

    await discoveryDb.reset()
    const second = await makeHeadDeps(
      [prop(1, { ...HOT, lastReconciledAt: ago(HOUR) })],
      {
        headChecks: 'dark',
        clock: () => later,
      },
    )
    await second.handler({} as never)

    expect(first.headCalls.at(0)?.options.jobId).toBe(
      second.headCalls.at(0)?.options.jobId,
    )
  })

  it('spreads the starts of a sweep’s head jobs over the same window as its snapshots', async () => {
    const rows = [1, 2, 3, 4, 5].map((n) =>
      prop(n, { ...HOT, lastReconciledAt: ago(HOUR) }),
    )
    const deps = await makeHeadDeps(rows, {
      headChecks: 'dark',
      spreadWindowMs: DISCOVERY_SPREAD_WINDOW_MS,
    })

    await deps.handler({} as never)

    const delays = deps.headCalls.map((call) => call.options.delayMs ?? 0)
    expect(delays.some((delay) => delay > 0)).toBe(true)
    expect(Math.max(...delays)).toBeLessThan(DISCOVERY_SWEEP_CADENCE_MS)
  })

  it('does not fail the sweep, hold its cursor or skip the date when a head job cannot be enqueued', async () => {
    const deps = await makeHeadDeps(
      [
        prop(1, { ...HOT, lastReconciledAt: ago(HOUR) }),
        prop(2, { ...HOT, lastReconciledAt: ago(HOUR) }),
      ],
      { headChecks: 'dark', failHeadEnqueue: true, batchSize: 1 },
    )

    await expect(deps.handler({} as never)).resolves.toBeUndefined()

    expect(
      await Promise.all(deps.rows.map(async (row) => (await stored(row)).nextDueAt)),
    ).toEqual([
      new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
      new Date(NOW.getTime() + DEFAULT_DISCOVERY_INTERVAL_MS),
    ])
    for (const row of deps.rows) expect((await stored(row)).errorClass).toBeNull()
    expect(deps.logger.warn).toHaveBeenCalledTimes(2)
    expect(finishedLog(deps)).toMatchObject({
      candidatesSeen: 2,
      skipped: 2,
      headChecksEnqueued: 0,
      headChecksFailed: 2,
    })
  })

  it('counts the head jobs in the sweep log without naming a Property', async () => {
    const deps = await makeHeadDeps(
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
