import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GBP_PUSH_SYNC_INITIATOR_ID } from './review-queue.port.server'
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

const { discoveryDb, seedRepo, stored } = useDiscoveryDb()

describe('sync-property-reviews snapshot handler', () => {
  // The Property's Google connection waits for a reconnect (a refresh Google
  // refused for good, a disconnect, a lost scope). The reconnect notice is the
  // signal, so a step that can no longer read Google ends as a returned
  // outcome: no throw, so no BullMQ retry, no dead letter, no Sentry error and
  // no latch on the family's repair state.
  describe('when the Google connection cannot be used', () => {
    const SKIPPED = { status: 'skipped', code: 'connection_unusable' } as const
    const targeted = {
      mode: 'targeted' as const,
      propertyId: JOB_DATA.propertyId,
      organizationId: JOB_DATA.organizationId,
      connectionId: JOB_DATA.connectionId,
      sourceEpoch: 7,
      referenceRef: null,
      deliveryId: '55555555-5555-4555-8555-555555555555',
      acceptedAt: '2026-08-21T11:58:00.000Z',
      notificationKind: 'NEW_REVIEW' as const,
      initiator: { kind: 'system' as const, id: GBP_PUSH_SYNC_INITIATOR_ID },
      correlationId: 'gbp-push-event',
    }
    const refused = (code: string) => Object.assign(new Error(code), { code })

    function targetedHandler(runTargetedFetch: () => Promise<unknown>) {
      const logger = { warn: vi.fn() }
      const enqueueContinuation = vi.fn(async () => undefined)
      const handler = createSyncPropertyReviewsHandler({
        runSnapshot: vi.fn() as never,
        runTargetedFetch: runTargetedFetch as never,
        propertySourceEpoch,
        enqueueContinuation,
        logger,
        ...ladderDeps(makeSyncActivity()),
      })
      return { handler, logger, enqueueContinuation }
    }

    it('ends a targeted fetch quietly, with one content-free warning', async () => {
      const { handler, logger, enqueueContinuation } = targetedHandler(
        async () => SKIPPED,
      )

      await expect(
        handler({ id: 'gbp-push-event', data: targeted } as never),
      ).resolves.toEqual(SKIPPED)

      expect(enqueueContinuation).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledTimes(1)
      expect(logger.warn).toHaveBeenCalledWith(
        { event: 'review_sync_skipped_connection_unusable', mode: 'targeted' },
        'Review sync skipped: the Google connection needs reconnecting',
      )
      const logged = JSON.stringify(logger.warn.mock.calls)
      expect(logged).not.toContain(JOB_DATA.propertyId)
      expect(logged).not.toContain(JOB_DATA.organizationId)
      expect(logged).not.toContain(JOB_DATA.connectionId)
    })

    it.each(['authorization_denied', 'authorization_changed', 'runtime_unavailable'])(
      'still fails a targeted fetch loudly when the connection is usable but %s',
      async (code) => {
        const { handler, logger } = targetedHandler(async () => {
          throw refused(code)
        })

        await expect(
          handler({ id: 'gbp-push-event', data: targeted } as never),
        ).rejects.toMatchObject({ code })
        expect(logger.warn).not.toHaveBeenCalled()
      },
    )

    describe('in a snapshot step', () => {
      const FAILED_UNUSABLE = {
        status: 'failed' as const,
        runId: '44444444-4444-4444-8444-444444444444',
        code: 'connection_unusable' as const,
      }

      async function snapshotHandler(rows: DiscoveryPropertyFixture[]) {
        const discoveryRepo = await seedRepo(rows)
        const markDeferred = vi.spyOn(discoveryRepo, 'markDiscoveryDeferred')
        const markSucceeded = vi.spyOn(discoveryRepo, 'markSyncSucceeded')
        const logger = { warn: vi.fn() }
        const enqueueContinuation = vi.fn(async () => undefined)
        const handler = createSyncPropertyReviewsHandler({
          runSnapshot: vi.fn(async () => FAILED_UNUSABLE) as never,
          propertySourceEpoch,
          enqueueContinuation,
          syncActivity: makeSyncActivity(),
          discoveryRepo,
          clock: () => NOW,
          hotIntervalMs: HOT_INTERVAL_MS,
          logger,
        })
        return {
          discoveryRepo,
          handler,
          logger,
          enqueueContinuation,
          markDeferred,
          markSucceeded,
        }
      }

      it('ends a run caught mid-way quietly, with no failure recorded and nothing continued', async () => {
        const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
        const { handler, logger, enqueueContinuation, markDeferred, markSucceeded } =
          await snapshotHandler([row])

        await expect(
          handler({
            id: 'job-snapshot-unusable',
            data: { ...JOB_DATA, runId: FAILED_UNUSABLE.runId },
          } as never),
        ).resolves.toEqual(SKIPPED)

        expect(enqueueContinuation).not.toHaveBeenCalled()
        expect(markDeferred).not.toHaveBeenCalled()
        expect(markSucceeded).not.toHaveBeenCalled()
        expect(logger.warn).toHaveBeenCalledTimes(1)
        expect(logger.warn).toHaveBeenCalledWith(
          { event: 'review_sync_skipped_connection_unusable', mode: 'snapshot' },
          'Review sync skipped: the Google connection needs reconnecting',
        )
        expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(JOB_DATA.propertyId)
      })

      it('leaves the discovery state alone, so the first poll after a reconnect starts a fresh run', async () => {
        const dueAt = new Date(NOW.getTime() + HOT_INTERVAL_MS)
        const row = discoveryProperty({
          propertyId: JOB_DATA.propertyId,
          nextDueAt: dueAt,
        })
        const { discoveryRepo, handler } = await snapshotHandler([row])

        await handler({ id: 'job-snapshot-unusable', data: JOB_DATA } as never)

        // No failure recorded and no wait pushed out: the backoff ladder never
        // sees a failure that only a reconnect can cure.
        expect((await stored(row)).errorClass).toBeNull()
        expect((await stored(row)).errorRetryAt).toBeNull()
        expect((await stored(row)).lastFailureAt).toBeNull()
        expect((await stored(row)).nextDueAt).toEqual(dueAt)

        // While the connection waits, the sweep does not select the Property
        // (it never enqueues a job that cannot run). Once it is reconnected the
        // Property is due on its own date and comes back as a candidate with no
        // outstanding failure.
        await discoveryDb.setConnectionStatus(row.connectionId!, 'reauth_required')
        expect(await discoveryRepo.findDuePropertiesBatch(dueAt, null, 10)).toEqual([])
        await discoveryDb.setConnectionStatus(row.connectionId!, 'active')
        const [candidate] = await discoveryRepo.findDuePropertiesBatch(dueAt, null, 10)
        expect(candidate).toMatchObject({
          propertyId: JOB_DATA.propertyId,
          hasOutstandingFailure: false,
        })
      })

      it('still records the failure and throws for authorization_denied, the refusal of a usable connection', async () => {
        const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
        const discoveryRepo = await seedRepo([row])
        const handler = createSyncPropertyReviewsHandler({
          runSnapshot: vi.fn(async () => ({
            ...FAILED_UNUSABLE,
            code: 'authorization_denied' as const,
          })) as never,
          propertySourceEpoch,
          enqueueContinuation: vi.fn(async () => undefined),
          syncActivity: makeSyncActivity(),
          discoveryRepo,
          clock: () => NOW,
          hotIntervalMs: HOT_INTERVAL_MS,
          logger: { warn: vi.fn() },
        })

        await expect(
          handler({ id: 'job-snapshot-denied', data: JOB_DATA } as never),
        ).rejects.toMatchObject({ failureCode: 'authorization_denied' })
        expect((await stored(row)).errorClass).toBe('authorization_denied')
      })
    })
  })

  // Google answered 400 or 404 on reviews.list for a location whose connection
  // is healthy. Asking again gets
  // the same answer, so the run ends as `provider_rejected` and the job parks
  // the location on the retry ladder instead of failing: three BullMQ attempts,
  // a dead letter and a repair latch per round told nobody anything new. The
  // failure stays recorded, so `sync.failed-nonzero` keeps naming the code.
  describe('when Google rejects the location (provider_rejected)', () => {
    const RUN_ID = '44444444-4444-4444-8444-444444444444'
    const MINUTE_MS = 60 * 1000
    const HOUR_MS = 60 * MINUTE_MS
    const STEP = { ...JOB_DATA, runId: RUN_ID }
    const REJECTED = {
      status: 'failed' as const,
      runId: RUN_ID,
      code: 'provider_rejected',
    }

    async function rejectedHandler(
      row: DiscoveryPropertyFixture,
      clock: { now: Date } = { now: NOW },
      outcome: unknown = REJECTED,
    ) {
      const discoveryRepo = await seedRepo([row])
      const markDeferred = vi.spyOn(discoveryRepo, 'markDiscoveryDeferred')
      const markSucceeded = vi.spyOn(discoveryRepo, 'markSyncSucceeded')
      const logger = { warn: vi.fn() }
      const enqueueContinuation = vi.fn(async () => undefined)
      const handler = createSyncPropertyReviewsHandler({
        runSnapshot: vi.fn(async () => outcome) as never,
        propertySourceEpoch,
        enqueueContinuation,
        syncActivity: makeSyncActivity(),
        discoveryRepo,
        clock: () => clock.now,
        hotIntervalMs: HOT_INTERVAL_MS,
        logger,
      })
      return { handler, logger, enqueueContinuation, markDeferred, markSucceeded }
    }

    it('ends the first step of a run without throwing, dated on the discovery interval', async () => {
      const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
      const { handler, markDeferred, markSucceeded, enqueueContinuation } =
        await rejectedHandler(row)

      await expect(
        handler({ id: 'job-rejected', data: JOB_DATA } as never),
      ).resolves.toMatchObject({ status: 'failed', code: 'provider_rejected' })

      expect(markDeferred).toHaveBeenCalledTimes(1)
      expect(markDeferred).toHaveBeenCalledWith(
        JOB_DATA.propertyId,
        NOW,
        new Date(NOW.getTime() + HOT_INTERVAL_MS),
        'provider_rejected',
      )
      expect(markSucceeded).not.toHaveBeenCalled()
      expect(enqueueContinuation).not.toHaveBeenCalled()
      expect(mocks.capture).not.toHaveBeenCalled()
    })

    it('keeps the failure and its retry date recorded so sync.failed-nonzero can name it once the date passes', async () => {
      const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
      const { handler } = await rejectedHandler(row)

      await handler({ id: 'job-rejected', data: JOB_DATA } as never)

      expect((await stored(row)).errorClass).toBe('provider_rejected')
      expect((await stored(row)).errorRetryAt).toEqual(
        new Date(NOW.getTime() + HOT_INTERVAL_MS),
      )
      expect((await stored(row)).lastFailureAt).toEqual(NOW)
    })

    it('waits 15 minutes, then 1 hour, 4 hours and 6 hours after consecutive rejections', async () => {
      const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
      const clock = { now: NOW }
      const { handler } = await rejectedHandler(row, clock)
      const waits: number[] = []

      for (let round = 0; round < 5; round++) {
        await handler({ id: 'job-ladder', data: JOB_DATA } as never)
        waits.push(
          ((await stored(row)).nextDueAt as Date).getTime() - clock.now.getTime(),
        )
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

    it('ends a step that continues a run without throwing or reporting it', async () => {
      const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
      const { handler, markDeferred, markSucceeded, enqueueContinuation } =
        await rejectedHandler(row)

      await expect(handler({ id: 'job-rejected', data: STEP } as never)).resolves.toEqual(
        REJECTED,
      )

      expect(mocks.capture).not.toHaveBeenCalled()
      expect(enqueueContinuation).not.toHaveBeenCalled()
      expect(markDeferred).toHaveBeenCalledWith(
        JOB_DATA.propertyId,
        NOW,
        new Date(NOW.getTime() + HOT_INTERVAL_MS),
        'provider_rejected',
      )
      expect(markSucceeded).not.toHaveBeenCalled()
    })

    it('logs the deferral with the code and the chosen wait, and no tenant identifier', async () => {
      const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
      const { handler, logger } = await rejectedHandler(row)

      await handler({ id: 'job-rejected', data: STEP } as never)

      expect(logger.warn).toHaveBeenCalledTimes(1)
      expect(logger.warn).toHaveBeenCalledWith(
        {
          event: 'review_snapshot_failure_deferred',
          failureCode: 'provider_rejected',
          retryAfterMs: HOT_INTERVAL_MS,
        },
        'Review snapshot failed; the next retry is backed off',
      )
    })

    // The retry of a step that failed its run finds it failed (run_already_failed)
    // and records nothing when the failing step dated the failure.
    it('ends the replay of a rejected run quietly and leaves the earned wait alone', async () => {
      const row = discoveryProperty({
        propertyId: JOB_DATA.propertyId,
        errorClass: 'provider_rejected',
        lastFailureAt: NOW,
        errorRetryAt: new Date(NOW.getTime() + HOT_INTERVAL_MS),
        nextDueAt: new Date(NOW.getTime() + HOT_INTERVAL_MS),
      })
      const { handler, markDeferred } = await rejectedHandler(
        row,
        { now: NOW },
        {
          ...REJECTED,
          alreadyFailed: { failedAt: NOW },
        },
      )
      const before = await stored(row)

      await expect(handler({ id: 'job-replay', data: STEP } as never)).resolves.toEqual({
        status: 'skipped',
        code: 'run_already_failed',
      })

      expect(markDeferred).not.toHaveBeenCalled()
      expect(await stored(row)).toEqual(before)
      expect(mocks.capture).not.toHaveBeenCalled()
    })

    it('records the replay of a rejection nobody dated, on the ladder, and still ends quietly', async () => {
      const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
      const { handler, markDeferred } = await rejectedHandler(
        row,
        { now: NOW },
        {
          ...REJECTED,
          alreadyFailed: { failedAt: new Date(NOW.getTime() - MINUTE_MS) },
        },
      )

      await expect(handler({ id: 'job-undated', data: STEP } as never)).resolves.toEqual({
        status: 'skipped',
        code: 'run_already_failed',
      })

      expect(markDeferred).toHaveBeenCalledWith(
        JOB_DATA.propertyId,
        NOW,
        new Date(NOW.getTime() + HOT_INTERVAL_MS),
        'provider_rejected',
      )
    })
  })
})
