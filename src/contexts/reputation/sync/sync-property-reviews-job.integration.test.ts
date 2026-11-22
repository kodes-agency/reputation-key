import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DISCOVERY_SWEEP_SYNC_INITIATOR_ID,
  GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID,
} from './review-queue.port.server'
import {
  discoveryProperty,
  type DiscoveryPropertyFixture,
} from '#/shared/testing/review-discovery-fixtures'
import { createSyncPropertyReviewsHandler } from './sync-property-reviews-job.server'
import {
  useDiscoveryDb,
  NOW,
  HOT_INTERVAL_MS,
  JOB_DATA,
  propertySourceEpoch,
  makeSyncActivity,
  makeDiscoveryState,
  ladderDeps,
} from './sync-property-reviews-job.test-fixtures'

const mocks = vi.hoisted(() => ({ capture: vi.fn() }))

vi.mock('#/shared/observability/telemetry', () => ({
  captureObservabilityException: mocks.capture,
}))
vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

beforeEach(() => {
  mocks.capture.mockClear()
})

const { seedRepo, stored } = useDiscoveryDb()

describe('sync-property-reviews snapshot handler', () => {
  it('executes one bounded step and enqueues its provider-token-free continuation', async () => {
    const runSnapshot = vi.fn(async () => ({
      status: 'checkpointed' as const,
      runId: '44444444-4444-4444-8444-444444444444',
      state: 'scanning' as const,
    }))
    const enqueueContinuation = vi.fn(async () => undefined)
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot,
      propertySourceEpoch,
      enqueueContinuation,
      ...ladderDeps(makeSyncActivity()),
    })

    await handler({ id: 'job-1', data: JOB_DATA } as never)

    expect(runSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEpoch: 7,
        locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
        observationOrigin: 'ongoing',
      }),
    )
    expect(enqueueContinuation).toHaveBeenCalledWith({
      ...JOB_DATA,
      sourceEpoch: 7,
      runId: '44444444-4444-4444-8444-444444444444',
    })
    expect(JSON.stringify(enqueueContinuation.mock.calls)).not.toContain('pageToken')
  })

  it('records the coded failure before throwing a content-free named error', async () => {
    const discoveryRepo = makeDiscoveryState()
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot: vi.fn(async () => ({
        status: 'failed' as const,
        runId: '44444444-4444-4444-8444-444444444444',
        code: 'authorization_denied' as const,
      })),
      propertySourceEpoch,
      enqueueContinuation: vi.fn(async () => undefined),
      ...ladderDeps(makeSyncActivity(), discoveryRepo),
    })

    await expect(
      handler({ id: 'job-coded-failure', data: JOB_DATA } as never),
    ).rejects.toMatchObject({
      name: 'ReviewProviderSnapshotFailure',
      message: 'authorization_denied',
      failureCode: 'authorization_denied',
    })
    expect(discoveryRepo.markDiscoveryDeferred).toHaveBeenCalledWith(
      JOB_DATA.propertyId,
      NOW,
      new Date(NOW.getTime() + HOT_INTERVAL_MS),
      'authorization_denied',
    )
    expect(discoveryRepo.markSyncSucceeded).not.toHaveBeenCalled()
  })

  // A location over the review cap (10,000 reviews, 200 pages) fails the same
  // way on every run until the cap or the location changes. Retrying it at the
  // discovery interval, with three BullMQ attempts and a quarantine entry per
  // round, only spends Google quota and fills the dead-letter queue (S14-05).
  it.each(['review_cap_exceeded', 'page_cap_exceeded'] as const)(
    'parks a location that fails %s for a day and ends the job without a retry',
    async (code) => {
      const discoveryRepo = makeDiscoveryState()
      const handler = createSyncPropertyReviewsHandler({
        runSnapshot: vi.fn(async () => ({
          status: 'failed' as const,
          runId: '44444444-4444-4444-8444-444444444444',
          code,
        })),
        propertySourceEpoch,
        enqueueContinuation: vi.fn(async () => undefined),
        ...ladderDeps(makeSyncActivity(), discoveryRepo),
      })

      await expect(
        handler({ id: 'job-too-large', data: JOB_DATA } as never),
      ).resolves.toMatchObject({ status: 'failed', code })

      expect(discoveryRepo.markDiscoveryDeferred).toHaveBeenCalledWith(
        JOB_DATA.propertyId,
        NOW,
        new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
        code,
      )
      expect(discoveryRepo.markSyncSucceeded).not.toHaveBeenCalled()
    },
  )

  // A deploy restarts the ephemeral cursor store and drops every cursor in it,
  // so a run caught mid-scan is lost, not broken. Failing the job for it put a
  // Sentry error, a dead letter and three alerts on every deploy.
  it('starts a fresh run at once, without a failure, when the cursor store lost the run', async () => {
    const discoveryRepo = makeDiscoveryState()
    const enqueueContinuation = vi.fn(async () => undefined)
    const lostRunId = '44444444-4444-4444-8444-444444444444'
    const initiator = { kind: 'system', id: GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID }
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot: vi.fn(async () => ({
        status: 'failed' as const,
        runId: lostRunId,
        code: 'cursor_lost' as const,
      })),
      propertySourceEpoch,
      enqueueContinuation,
      ...ladderDeps(makeSyncActivity(), discoveryRepo),
    })

    await expect(
      handler({
        id: 'job-cursor-lost',
        data: { ...JOB_DATA, initiator, sourceEpoch: 7, runId: lostRunId },
      } as never),
    ).resolves.toMatchObject({ status: 'failed', code: 'cursor_lost' })

    // No runId: the next step starts (or joins) a run from page 0 under the
    // same initiator, so an interrupted import stays an import.
    expect(enqueueContinuation).toHaveBeenCalledTimes(1)
    expect(enqueueContinuation).toHaveBeenCalledWith({
      ...JOB_DATA,
      initiator,
      sourceEpoch: 7,
    })
    // Not a coded failure: `sync.failed-nonzero` stays quiet.
    expect(discoveryRepo.markDiscoveryDeferred).not.toHaveBeenCalled()
    expect(discoveryRepo.markSyncSucceeded).not.toHaveBeenCalled()
  })

  // A guest who posts while a run is between its two listings changes the set
  // the confirmation must find again. The run removes nothing and is simply
  // run again: failing the job for it put a Sentry error, a dead letter, an
  // alert and a repair latch on a large Property.
  it('starts a fresh run at once, without a failure, when the listing changed between the scans', async () => {
    const discoveryRepo = makeDiscoveryState()
    const enqueueContinuation = vi.fn(async () => undefined)
    const changedRunId = '44444444-4444-4444-8444-444444444444'
    const initiator = { kind: 'system', id: DISCOVERY_SWEEP_SYNC_INITIATOR_ID }
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot: vi.fn(async () => ({
        status: 'failed' as const,
        runId: changedRunId,
        code: 'listing_changed' as const,
      })),
      propertySourceEpoch,
      enqueueContinuation,
      ...ladderDeps(makeSyncActivity(), discoveryRepo),
    })

    await expect(
      handler({
        id: 'job-listing-changed',
        data: { ...JOB_DATA, initiator, sourceEpoch: 7, runId: changedRunId },
      } as never),
    ).resolves.toMatchObject({ status: 'failed', code: 'listing_changed' })

    expect(enqueueContinuation).toHaveBeenCalledTimes(1)
    expect(enqueueContinuation).toHaveBeenCalledWith({
      ...JOB_DATA,
      initiator,
      sourceEpoch: 7,
    })
    expect(discoveryRepo.markDiscoveryDeferred).not.toHaveBeenCalled()
    expect(discoveryRepo.markSyncSucceeded).not.toHaveBeenCalled()
  })

  // Google's total (or average) moving while a run is still reading its pages
  // is the same thing seen earlier: a guest posted mid-run. The store records
  // it as `listing_changed`, so the job restarts the sync the same way, at
  // once and under the same initiator, however far into the pages the run was
  // (the largest beta location failed at page 7 and at page 65 of 75).
  it.each([
    { label: 'a first import', id: GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID },
    { label: 'a discovery poll', id: DISCOVERY_SWEEP_SYNC_INITIATOR_ID },
  ])(
    'starts a fresh run for $label at once, without a failure, when the total moved mid-scan',
    async ({ id }) => {
      const discoveryRepo = makeDiscoveryState()
      const enqueueContinuation = vi.fn(async () => undefined)
      const changedRunId = '44444444-4444-4444-8444-444444444444'
      const initiator = { kind: 'system', id }
      const runSnapshot = vi.fn(async () => ({
        status: 'failed' as const,
        runId: changedRunId,
        code: 'listing_changed' as const,
      }))
      const handler = createSyncPropertyReviewsHandler({
        runSnapshot,
        propertySourceEpoch,
        enqueueContinuation,
        ...ladderDeps(makeSyncActivity(), discoveryRepo),
      })

      await expect(
        handler({
          id: 'job-total-moved',
          data: { ...JOB_DATA, initiator, sourceEpoch: 7, runId: changedRunId },
        } as never),
      ).resolves.toMatchObject({ status: 'failed', code: 'listing_changed' })

      // The run that changed is not resumed: the next step carries no runId.
      expect(enqueueContinuation).toHaveBeenCalledTimes(1)
      expect(enqueueContinuation).toHaveBeenCalledWith({
        ...JOB_DATA,
        initiator,
        sourceEpoch: 7,
      })
      expect(discoveryRepo.markDiscoveryDeferred).not.toHaveBeenCalled()
      expect(discoveryRepo.markSyncSucceeded).not.toHaveBeenCalled()
    },
  )

  // `cursor_failure` is what the use case answers when the cursor vanished
  // with no store restart to explain it: a defect, so it still fails loudly.
  // `confirmation_set_changed`, `total_changed`, `average_changed` and
  // `duplicate_resource` are what the store records once a Property's listing
  // has changed under several runs in a row (or, for the last, a page that
  // lists a review twice): a paging defect, not a guest posting, so they fail
  // loudly too.
  it.each([
    'source_changed',
    'malformed_page',
    'observation_failed',
    'cursor_failure',
    'confirmation_set_changed',
    'total_changed',
    'average_changed',
    'duplicate_resource',
  ] as const)('still retries at the discovery interval after %s', async (code) => {
    const discoveryRepo = makeDiscoveryState()
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot: vi.fn(async () => ({
        status: 'failed' as const,
        runId: '44444444-4444-4444-8444-444444444444',
        code,
      })),
      propertySourceEpoch,
      enqueueContinuation: vi.fn(async () => undefined),
      ...ladderDeps(makeSyncActivity(), discoveryRepo),
    })

    await expect(
      handler({ id: 'job-transient', data: JOB_DATA } as never),
    ).rejects.toMatchObject({
      name: 'ReviewProviderSnapshotFailure',
      message: code,
      failureCode: code,
    })
    expect(discoveryRepo.markDiscoveryDeferred).toHaveBeenCalledWith(
      JOB_DATA.propertyId,
      NOW,
      new Date(NOW.getTime() + HOT_INTERVAL_MS),
      code,
    )
  })

  // A failure that repeats waits longer each time (reputation/domain/snapshot-failure-backoff.ts):
  // 15 minutes, then 1 hour, 4 hours, and at most 6 hours. The tests below run
  // the real handler against the in-memory repository, one failure per hop in
  // time, and read back the retry date the repository holds.
  describe('failure backoff', () => {
    const MINUTE_MS = 60 * 1000
    const HOUR_MS = 60 * MINUTE_MS

    async function failingHandler(
      rows: DiscoveryPropertyFixture[],
      outcome: { status: 'failed'; runId: string; code: 'provider_failure' | string },
      clock: { now: Date },
    ) {
      const discoveryRepo = await seedRepo(rows)
      const logger = { warn: vi.fn(), info: vi.fn() }
      const handler = createSyncPropertyReviewsHandler({
        runSnapshot: vi.fn(async () => outcome) as never,
        propertySourceEpoch,
        enqueueContinuation: vi.fn(async () => undefined),
        syncActivity: makeSyncActivity(),
        discoveryRepo,
        clock: () => clock.now,
        hotIntervalMs: HOT_INTERVAL_MS,
        logger,
      })
      return { discoveryRepo, handler, logger }
    }

    const FAILED = {
      status: 'failed' as const,
      runId: '44444444-4444-4444-8444-444444444444',
      code: 'observation_failed',
    }

    async function failOnce(handler: (job: never) => Promise<unknown>) {
      await expect(
        handler({ id: 'job-backoff', data: JOB_DATA } as never),
      ).rejects.toThrow('observation_failed')
    }

    it('dates the retry 15 minutes, then 1 hour, then 4 hours, then 6 hours after consecutive failures', async () => {
      const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
      const clock = { now: NOW }
      const { handler } = await failingHandler([row], FAILED as never, clock)
      const waits: number[] = []

      for (let failure = 0; failure < 5; failure++) {
        await failOnce(handler as never)
        waits.push(
          ((await stored(row)).nextDueAt as Date).getTime() - clock.now.getTime(),
        )
        // The scheduled retry comes due and fails again.
        clock.now = (await stored(row)).nextDueAt as Date
      }

      expect(waits).toEqual([
        15 * MINUTE_MS,
        HOUR_MS,
        4 * HOUR_MS,
        6 * HOUR_MS,
        6 * HOUR_MS,
      ])
    })

    it('keeps the retry date and the next look together at every deferral', async () => {
      const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
      const clock = { now: NOW }
      const { handler } = await failingHandler([row], FAILED as never, clock)

      await failOnce(handler as never)
      clock.now = (await stored(row)).nextDueAt as Date
      await failOnce(handler as never)

      expect((await stored(row)).errorRetryAt).toEqual((await stored(row)).nextDueAt)
      expect((await stored(row)).lastFailureAt).toEqual(clock.now)
    })

    it('does not climb the ladder when the queue retries the same failed job before the retry came due', async () => {
      const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
      const clock = { now: NOW }
      const { handler } = await failingHandler([row], FAILED as never, clock)

      await failOnce(handler as never)
      clock.now = new Date(NOW.getTime() + 2 * MINUTE_MS) // BullMQ attempt 2
      await failOnce(handler as never)
      clock.now = new Date(NOW.getTime() + 5 * MINUTE_MS) // BullMQ attempt 3
      await failOnce(handler as never)

      expect(
        ((await stored(row)).nextDueAt as Date).getTime() - clock.now.getTime(),
      ).toBe(15 * MINUTE_MS)
    })

    it('starts again at 15 minutes after a completed run clears the failure', async () => {
      const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
      const clock = { now: NOW }
      const failing = await failingHandler([row], FAILED as never, clock)
      await failOnce(failing.handler as never)
      clock.now = (await stored(row)).nextDueAt as Date
      await failOnce(failing.handler as never)
      expect((await stored(row)).errorRetryAt).not.toBeNull()

      const completing = createSyncPropertyReviewsHandler({
        runSnapshot: vi.fn(async () => ({
          status: 'completed' as const,
          runId: FAILED.runId,
        })),
        propertySourceEpoch,
        enqueueContinuation: vi.fn(async () => undefined),
        syncActivity: makeSyncActivity(),
        discoveryRepo: failing.discoveryRepo,
        clock: () => clock.now,
        hotIntervalMs: HOT_INTERVAL_MS,
      })
      await completing({ id: 'job-ok', data: JOB_DATA } as never)
      expect((await stored(row)).errorClass).toBeNull()

      clock.now = new Date(clock.now.getTime() + HOUR_MS)
      await failOnce(failing.handler as never)
      expect(
        ((await stored(row)).nextDueAt as Date).getTime() - clock.now.getTime(),
      ).toBe(15 * MINUTE_MS)
    })

    it('parks a location over the cap for a day however often it failed before', async () => {
      const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
      const clock = { now: NOW }
      const failing = await failingHandler([row], FAILED as never, clock)
      await failOnce(failing.handler as never)
      clock.now = (await stored(row)).nextDueAt as Date

      const tooLarge = await failingHandler(
        [row],
        { ...FAILED, code: 'review_cap_exceeded' } as never,
        clock,
      )
      await tooLarge.handler({ id: 'job-too-large', data: JOB_DATA } as never)

      expect(
        ((await stored(row)).nextDueAt as Date).getTime() - clock.now.getTime(),
      ).toBe(24 * HOUR_MS)
    })

    it('logs the chosen interval and nothing from the payload', async () => {
      const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
      const clock = { now: NOW }
      const { handler, logger } = await failingHandler([row], FAILED as never, clock)

      await failOnce(handler as never)
      clock.now = (await stored(row)).nextDueAt as Date
      await failOnce(handler as never)

      expect(logger.warn).toHaveBeenLastCalledWith(
        {
          event: 'review_snapshot_failure_deferred',
          failureCode: 'observation_failed',
          retryAfterMs: HOUR_MS,
        },
        'Review snapshot failed; the next retry is backed off',
      )
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(JOB_DATA.propertyId)
    })

    it.each(['cursor_lost', 'listing_changed'] as const)(
      'restarts at once after %s and records no failure or interval',
      async (code) => {
        const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
        const clock = { now: NOW }
        const enqueueContinuation = vi.fn(async () => undefined)
        const discoveryRepo = await seedRepo([row])
        const handler = createSyncPropertyReviewsHandler({
          runSnapshot: vi.fn(async () => ({ ...FAILED, code })) as never,
          propertySourceEpoch,
          enqueueContinuation,
          syncActivity: makeSyncActivity(),
          discoveryRepo,
          clock: () => clock.now,
          hotIntervalMs: HOT_INTERVAL_MS,
        })

        await handler({ id: 'job-restart', data: JOB_DATA } as never)

        expect(enqueueContinuation).toHaveBeenCalledTimes(1)
        expect((await stored(row)).errorClass).toBeNull()
        expect((await stored(row)).nextDueAt).toBeNull()
        expect((await stored(row)).lastFailureAt).toBeNull()
      },
    )
  })

  it('clears prior sync failure state only after a completed run', async () => {
    const discoveryRepo = makeDiscoveryState()
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot: vi.fn(async () => ({
        status: 'completed' as const,
        runId: '44444444-4444-4444-8444-444444444444',
      })),
      propertySourceEpoch,
      enqueueContinuation: vi.fn(async () => undefined),
      ...ladderDeps(makeSyncActivity(), discoveryRepo),
    })

    await handler({ id: 'job-completed', data: JOB_DATA } as never)

    expect(discoveryRepo.markSyncSucceeded).toHaveBeenCalledWith(JOB_DATA.propertyId)
    expect(discoveryRepo.markDiscoveryDeferred).not.toHaveBeenCalled()
  })
})
