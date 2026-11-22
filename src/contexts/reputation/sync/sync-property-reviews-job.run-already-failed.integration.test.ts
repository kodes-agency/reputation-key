import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTerminalFailedEvent } from '#/shared/jobs/failure-quarantine'
import {
  discoveryProperty,
  type DiscoveryPropertyFixture,
} from '#/shared/testing/review-discovery-fixtures'
import { ReviewProviderSnapshotFailure } from './review-provider-snapshot-failure.server'
import { createSyncPropertyReviewsHandler } from './sync-property-reviews-job.server'
import {
  useDiscoveryDb,
  NOW,
  HOT_INTERVAL_MS,
  JOB_DATA,
  propertySourceEpoch,
  makeSyncActivity,
  throwSite,
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
  // A step is queued with the id of its run. A run that already failed cannot
  // be continued, so a step that finds it so (the queue retrying the step that
  // failed it, a redrive of its dead letter) has nothing left to fail. The
  // attempt that failed the run was loud: it reported the failure to error
  // monitoring itself, because the retry that follows ends quietly and the
  // worker only reports a failure that is terminal. A replay that fails again
  // only pushes the Property's backoff out, dead-letters the job and latches
  // the family's repair state, and no redrive can ever succeed.
  describe('when the run a step continues has already failed', () => {
    const RUN_ID = '44444444-4444-4444-8444-444444444444'
    const SKIPPED = { status: 'skipped', code: 'run_already_failed' } as const
    const STEP = { ...JOB_DATA, runId: RUN_ID }
    const MINUTE_MS = 60 * 1000

    /** When the run failed, as the store dates it: the instant the failing step recorded it. */
    const RUN_FAILED_AT = NOW

    /** The job as the worker's `failed` event sees it after attempt `made` of three. */
    const afterAttempt = (made: number) =>
      ({ attemptsMade: made, opts: { attempts: 3 } }) as Job

    const fresh = (code: string) => ({ status: 'failed' as const, runId: RUN_ID, code })
    const replay = (code: string, failedAt: Date | null = RUN_FAILED_AT) => ({
      ...fresh(code),
      alreadyFailed: { failedAt },
    })

    async function replayHandler(
      outcomes: readonly unknown[],
      row: DiscoveryPropertyFixture,
      clock: { now: Date } = { now: NOW },
    ) {
      const discoveryRepo = await seedRepo([row])
      const markDeferred = vi.spyOn(discoveryRepo, 'markDiscoveryDeferred')
      const markSucceeded = vi.spyOn(discoveryRepo, 'markSyncSucceeded')
      const logger = { warn: vi.fn() }
      const enqueueContinuation = vi.fn(async () => undefined)
      const runSnapshot = vi.fn()
      for (const outcome of outcomes) runSnapshot.mockResolvedValueOnce(outcome)
      const handler = createSyncPropertyReviewsHandler({
        runSnapshot: runSnapshot as never,
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

    // The Property is inside the backoff the failing attempt earned.
    const failedRow = () =>
      discoveryProperty({
        propertyId: JOB_DATA.propertyId,
        errorClass: 'observation_failed',
        lastFailureAt: NOW,
        errorRetryAt: new Date(NOW.getTime() + HOT_INTERVAL_MS),
        nextDueAt: new Date(NOW.getTime() + HOT_INTERVAL_MS),
      })

    it.each([
      'observation_failed',
      'provider_failure',
      'cursor_failure',
      'malformed_page',
      'authorization_denied',
      'confirmation_set_changed',
    ])(
      'ends quietly when the run failed as %s: no throw, no failure recorded, nothing continued',
      async (code) => {
        const row = failedRow()
        const { handler, enqueueContinuation, markDeferred, markSucceeded } =
          await replayHandler([replay(code)], row)
        const before = await stored(row)

        await expect(handler({ id: 'job-replay', data: STEP } as never)).resolves.toEqual(
          SKIPPED,
        )

        expect(markDeferred).not.toHaveBeenCalled()
        expect(markSucceeded).not.toHaveBeenCalled()
        expect(enqueueContinuation).not.toHaveBeenCalled()
        expect(await stored(row)).toEqual(before)
        expect(mocks.capture).not.toHaveBeenCalled()
      },
    )

    it('writes one warning of closed codes and names no tenant identifier', async () => {
      const { handler, logger } = await replayHandler(
        [replay('observation_failed')],
        failedRow(),
      )

      await handler({ id: 'job-replay', data: STEP } as never)

      expect(logger.warn).toHaveBeenCalledTimes(1)
      expect(logger.warn).toHaveBeenCalledWith(
        {
          event: 'review_sync_skipped_run_already_failed',
          failureCode: 'observation_failed',
        },
        'Review sync skipped: the run had already failed',
      )
      const logged = JSON.stringify(logger.warn.mock.calls)
      expect(logged).not.toContain(JOB_DATA.propertyId)
      expect(logged).not.toContain(JOB_DATA.organizationId)
      expect(logged).not.toContain(JOB_DATA.connectionId)
      expect(logged).not.toContain(RUN_ID)
    })

    // A lock can time out one step's observation write and fail its run; every
    // retry of that step must fail the job again until it is dead-lettered.
    it('fails the job for the step that failed the run, and only for that step', async () => {
      const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
      const clock = { now: NOW }
      const { handler, markDeferred, logger } = await replayHandler(
        [
          fresh('observation_failed'),
          replay('observation_failed'),
          replay('observation_failed'),
        ],
        row,
        clock,
      )

      await expect(
        handler({ id: 'job-incident', data: STEP } as never),
      ).rejects.toMatchObject({
        name: 'ReviewProviderSnapshotFailure',
        message: 'observation_failed',
        failureCode: 'observation_failed',
      })
      const earned = await stored(row)
      expect(((await stored(row)).nextDueAt as Date).getTime() - NOW.getTime()).toBe(
        HOT_INTERVAL_MS,
      )

      clock.now = new Date(NOW.getTime() + 18 * MINUTE_MS) // BullMQ attempt 2
      await expect(handler({ id: 'job-incident', data: STEP } as never)).resolves.toEqual(
        SKIPPED,
      )
      clock.now = new Date(NOW.getTime() + 19 * MINUTE_MS) // BullMQ attempt 3
      await expect(handler({ id: 'job-incident', data: STEP } as never)).resolves.toEqual(
        SKIPPED,
      )

      // One deferral, dated by the failing attempt; the replays moved nothing.
      expect(markDeferred).toHaveBeenCalledTimes(1)
      expect(markDeferred).toHaveBeenCalledWith(
        JOB_DATA.propertyId,
        NOW,
        new Date(NOW.getTime() + HOT_INTERVAL_MS),
        'observation_failed',
      )
      expect(await stored(row)).toEqual(earned)
      expect(
        logger.warn.mock.calls.filter(
          ([fields]) => fields.event === 'review_snapshot_failure_deferred',
        ),
      ).toHaveLength(1)
      // One failure, one report: the replays added none.
      expect(mocks.capture).toHaveBeenCalledTimes(1)
    })

    it('records the failure and throws when the run fails in this very step', async () => {
      const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
      const { handler, markDeferred, logger } = await replayHandler(
        [fresh('provider_failure')],
        row,
      )

      await expect(
        handler({ id: 'job-fresh', data: STEP } as never),
      ).rejects.toMatchObject({
        name: 'ReviewProviderSnapshotFailure',
        failureCode: 'provider_failure',
      })

      expect(markDeferred).toHaveBeenCalledWith(
        JOB_DATA.propertyId,
        NOW,
        new Date(NOW.getTime() + HOT_INTERVAL_MS),
        'provider_failure',
      )
      expect((await stored(row)).errorClass).toBe('provider_failure')
      expect(logger.warn).toHaveBeenCalledWith(
        {
          event: 'review_snapshot_failure_deferred',
          failureCode: 'provider_failure',
          retryAfterMs: HOT_INTERVAL_MS,
        },
        'Review snapshot failed; the next retry is backed off',
      )
    })

    // The worker reports a failure only when it is terminal, and the retry of a
    // step that continues a run ends quietly, so the failure of the attempt that
    // failed the run would never be reported at all unless that attempt does it.
    // It reports the very error it throws, so it keeps grouping into the
    // existing ReviewProviderSnapshotFailure issue with its failure_code tag.
    it.each(['observation_failed', 'provider_failure', 'cursor_failure'] as const)(
      'reports a step that fails its run as %s once, before it throws',
      async (code) => {
        const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
        const { handler, markDeferred } = await replayHandler([fresh(code)], row)

        const thrown = await handler({ id: 'job-reported', data: STEP } as never).catch(
          (err: unknown) => err,
        )

        expect(thrown).toBeInstanceOf(ReviewProviderSnapshotFailure)
        expect(thrown).toMatchObject({ failureCode: code, message: code })
        expect(mocks.capture).toHaveBeenCalledTimes(1)
        expect(mocks.capture.mock.calls[0]?.[0]).toBe(thrown)
        expect(mocks.capture.mock.calls[0]?.[1]).toEqual({
          source: 'bullmq-job',
          queue: 'default',
          jobName: 'sync-property-reviews',
        })
        expect(markDeferred).toHaveBeenCalledTimes(1)
        expect((await stored(row)).errorClass).toBe(code)
      },
    )

    // Error monitoring has no fingerprint of its own here (the scrub deletes it),
    // so it groups by stack, and the existing ReviewProviderSnapshotFailure issue
    // is grouped under runSnapshotStep, the
    // function that built the error before the explicit report. A helper that
    // builds it moves the frame and the report would open a new issue.
    it.each([
      ['a step that continues a run', STEP],
      ['the first step of a run', JOB_DATA],
    ])(
      'builds the error of %s in runSnapshotStep, where its issue is grouped',
      async (_name, data) => {
        const { handler } = await replayHandler(
          [fresh('observation_failed')],
          discoveryProperty({ propertyId: JOB_DATA.propertyId }),
        )

        const thrown = await handler({ id: 'job-stack', data } as never).catch(
          (err: unknown) => err,
        )

        expect(thrown).toBeInstanceOf(ReviewProviderSnapshotFailure)
        expect(throwSite(thrown as Error)).toBe('runSnapshotStep')
      },
    )

    // The failure is an ordinary one: BullMQ retries the step, and the retry
    // finds the run failed and ends quietly (see the incident above). Nothing
    // is terminal, so the worker neither reports it again nor dead-letters it.
    it('keeps the failure of a step that continues a run retryable', async () => {
      const { handler } = await replayHandler(
        [fresh('observation_failed')],
        discoveryProperty({ propertyId: JOB_DATA.propertyId }),
      )

      const failure = await handler({ id: 'job-retryable', data: STEP } as never).catch(
        (err: unknown) => err,
      )

      expect(isTerminalFailedEvent(afterAttempt(1), failure)).toBe(false)
    })

    // A location over the cap is parked and the job ends normally: nothing
    // throws, so nothing is reported, as before the run id mattered.
    it('does not report a location parked for being over the cap', async () => {
      const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
      const { handler } = await replayHandler([fresh('review_cap_exceeded')], row)

      await expect(handler({ id: 'job-cap', data: STEP } as never)).resolves.toEqual(
        fresh('review_cap_exceeded'),
      )

      expect(mocks.capture).not.toHaveBeenCalled()
    })

    // The first step of a run has no run id: its retry starts a new run, which
    // can succeed, so it keeps its attempts and is terminal when they are spent.
    it('keeps the failure of the first step of a run retryable until its attempts are spent', async () => {
      const { handler } = await replayHandler(
        [fresh('observation_failed')],
        discoveryProperty({ propertyId: JOB_DATA.propertyId }),
      )

      const failure = await handler({
        id: 'job-first-step',
        data: JOB_DATA,
      } as never).catch((err: unknown) => err)

      expect(failure).toMatchObject({
        name: 'ReviewProviderSnapshotFailure',
        failureCode: 'observation_failed',
      })
      expect(isTerminalFailedEvent(afterAttempt(1), failure)).toBe(false)
      expect(isTerminalFailedEvent(afterAttempt(3), failure)).toBe(true)
    })

    // Its retry starts a new run, so the step itself does not report: the
    // worker does, once, when the attempts are spent. Reporting here as well
    // would count one failure twice.
    it('leaves the report of the failure of the first step of a run to the worker', async () => {
      const { handler } = await replayHandler(
        [fresh('observation_failed')],
        discoveryProperty({ propertyId: JOB_DATA.propertyId }),
      )

      await expect(
        handler({ id: 'job-first-step', data: JOB_DATA } as never),
      ).rejects.toBeInstanceOf(ReviewProviderSnapshotFailure)

      expect(mocks.capture).not.toHaveBeenCalled()
    })

    // The failing step fails the run first and records the failure second, in
    // two writes. A worker that dies between them leaves a failed run and no
    // failure on the Property, and the queue's retry is the only step left that
    // can record it.
    describe('and the step that failed it never recorded the failure', () => {
      it('records the failure once, dates the retry, and still ends quietly', async () => {
        const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
        const clock = { now: new Date(NOW.getTime() + 30 * 1000) }
        const { handler, markDeferred, logger } = await replayHandler(
          [replay('observation_failed'), replay('observation_failed')],
          row,
          clock,
        )

        await expect(handler({ id: 'job-died', data: STEP } as never)).resolves.toEqual(
          SKIPPED,
        )
        clock.now = new Date(NOW.getTime() + 60 * 1000)
        await expect(handler({ id: 'job-died', data: STEP } as never)).resolves.toEqual(
          SKIPPED,
        )

        expect(markDeferred).toHaveBeenCalledTimes(1)
        expect(markDeferred).toHaveBeenCalledWith(
          JOB_DATA.propertyId,
          new Date(NOW.getTime() + 30 * 1000),
          new Date(NOW.getTime() + 30 * 1000 + HOT_INTERVAL_MS),
          'observation_failed',
        )
        expect((await stored(row)).errorClass).toBe('observation_failed')
        expect(
          logger.warn.mock.calls.filter(
            ([fields]) => fields.event === 'review_snapshot_failure_deferred',
          ),
        ).toHaveLength(1)
        expect(mocks.capture).not.toHaveBeenCalled()
      })

      it('records it when the Property holds only an older failure, climbing the ladder', async () => {
        const olderFailureAt = new Date(NOW.getTime() - 2 * 60 * MINUTE_MS)
        const row = discoveryProperty({
          propertyId: JOB_DATA.propertyId,
          errorClass: 'provider_failure',
          lastFailureAt: olderFailureAt,
          errorRetryAt: new Date(olderFailureAt.getTime() + HOT_INTERVAL_MS),
          nextDueAt: new Date(olderFailureAt.getTime() + HOT_INTERVAL_MS),
        })
        const { handler, markDeferred } = await replayHandler(
          [replay('observation_failed', new Date(NOW.getTime() - MINUTE_MS))],
          row,
        )

        await expect(handler({ id: 'job-older', data: STEP } as never)).resolves.toEqual(
          SKIPPED,
        )

        expect(markDeferred).toHaveBeenCalledWith(
          JOB_DATA.propertyId,
          NOW,
          new Date(NOW.getTime() + 4 * HOT_INTERVAL_MS),
          'observation_failed',
        )
      })

      it('parks a location over the cap for a day, as the failing step would have', async () => {
        const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
        const { handler, markDeferred } = await replayHandler(
          [replay('review_cap_exceeded')],
          row,
        )

        await expect(handler({ id: 'job-capped', data: STEP } as never)).resolves.toEqual(
          SKIPPED,
        )

        expect(markDeferred).toHaveBeenCalledWith(
          JOB_DATA.propertyId,
          NOW,
          new Date(NOW.getTime() + 24 * 60 * MINUTE_MS),
          'review_cap_exceeded',
        )
      })

      // A dead letter redriven days later, after a run has completed since.
      it('records nothing for a failure a later success has cleared', async () => {
        const row = discoveryProperty({
          propertyId: JOB_DATA.propertyId,
          errorClass: null,
          lastFailureAt: NOW,
          errorRetryAt: null,
        })
        const { handler, markDeferred } = await replayHandler(
          [replay('observation_failed', new Date(NOW.getTime() - MINUTE_MS))],
          row,
        )

        await expect(handler({ id: 'job-late', data: STEP } as never)).resolves.toEqual(
          SKIPPED,
        )

        expect(markDeferred).not.toHaveBeenCalled()
        expect((await stored(row)).errorClass).toBeNull()
      })

      it('records nothing when the store has no date for the run and the Property holds a failure', async () => {
        const row = failedRow()
        const { handler, markDeferred } = await replayHandler(
          [replay('observation_failed', null)],
          row,
        )
        const before = await stored(row)

        await expect(
          handler({ id: 'job-undated', data: STEP } as never),
        ).resolves.toEqual(SKIPPED)

        expect(markDeferred).not.toHaveBeenCalled()
        expect(await stored(row)).toEqual(before)
      })
    })

    it('leaves a location parked for being over the cap parked', async () => {
      const parkedUntil = new Date(NOW.getTime() + 24 * 60 * MINUTE_MS)
      const row = discoveryProperty({
        propertyId: JOB_DATA.propertyId,
        errorClass: 'review_cap_exceeded',
        lastFailureAt: NOW,
        errorRetryAt: parkedUntil,
        nextDueAt: parkedUntil,
      })
      const { handler, markDeferred } = await replayHandler(
        [replay('review_cap_exceeded')],
        row,
      )

      await expect(handler({ id: 'job-parked', data: STEP } as never)).resolves.toEqual(
        SKIPPED,
      )

      expect(markDeferred).not.toHaveBeenCalled()
      expect((await stored(row)).nextDueAt).toEqual(parkedUntil)
    })

    // The step that lost the run may have died before it queued the fresh one
    // (a Redis blip on the enqueue): its retry is the only thing that does.
    it.each(['cursor_lost', 'listing_changed'] as const)(
      'still starts the fresh run when it finds the run lost as %s',
      async (code) => {
        const row = discoveryProperty({ propertyId: JOB_DATA.propertyId })
        const { handler, enqueueContinuation, markDeferred } = await replayHandler(
          [replay(code)],
          row,
        )

        await expect(
          handler({ id: 'job-restart', data: STEP } as never),
        ).resolves.not.toEqual(SKIPPED)

        expect(enqueueContinuation).toHaveBeenCalledTimes(1)
        expect(enqueueContinuation).toHaveBeenCalledWith({ ...JOB_DATA, sourceEpoch: 7 })
        expect(markDeferred).not.toHaveBeenCalled()
        expect((await stored(row)).errorClass).toBeNull()
      },
    )

    it('keeps the reconnect skip for a run that failed as connection_unusable', async () => {
      const { handler, logger, markDeferred } = await replayHandler(
        [replay('connection_unusable')],
        failedRow(),
      )

      await expect(handler({ id: 'job-replay', data: STEP } as never)).resolves.toEqual({
        status: 'skipped',
        code: 'connection_unusable',
      })

      expect(markDeferred).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledTimes(1)
      expect(logger.warn).toHaveBeenCalledWith(
        { event: 'review_sync_skipped_connection_unusable', mode: 'snapshot' },
        'Review sync skipped: the Google connection needs reconnecting',
      )
    })
  })
})
