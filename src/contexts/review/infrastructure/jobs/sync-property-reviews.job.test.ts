import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTerminalFailedEvent } from '#/shared/jobs/failure-quarantine'
import {
  DISCOVERY_SWEEP_SYNC_INITIATOR_ID,
  GBP_PUSH_SYNC_INITIATOR_ID,
  GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID,
} from '../../application/ports/review-queue.port'
import type { ReviewSyncActivityRecorder } from '../../application/ports/review-sync-activity.port'
import type { ReviewDiscoveryRepository } from '../../application/ports/review-discovery.repository'
import {
  createFakeReviewDiscoveryRepository,
  fakeDiscoveryProperty,
} from '#/shared/testing/fake-review-discovery-repository'
import { ReviewProviderSnapshotFailure } from './review-provider-snapshot-failure'
import { createSyncPropertyReviewsHandler } from './sync-property-reviews.job'

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

const NOW = new Date('2026-08-21T12:00:00.000Z')
const HOT_INTERVAL_MS = 15 * 60 * 1000

const JOB_DATA = {
  propertyId: '11111111-1111-4111-8111-111111111111',
  organizationId: '33333333-3333-4333-8333-333333333333',
  connectionId: '22222222-2222-4222-8222-222222222222',
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
}

const propertySourceEpoch = {
  getSourceEpoch: vi.fn(async () => ({ sourceEpoch: 7 })),
}

const makeSyncActivity = (): ReviewSyncActivityRecorder => ({
  recordNewReviewObserved: vi.fn(async () => undefined),
  recordPushObserved: vi.fn(async () => undefined),
})

const makeDiscoveryState = (): Pick<
  ReviewDiscoveryRepository,
  'markDiscoveryDeferred' | 'findFailureState' | 'markSyncSucceeded'
> => ({
  markDiscoveryDeferred: vi.fn(async () => undefined),
  findFailureState: vi.fn(async () => null),
  markSyncSucceeded: vi.fn(async () => undefined),
})

const ladderDeps = (
  syncActivity: ReviewSyncActivityRecorder,
  discoveryRepo = makeDiscoveryState(),
) => ({
  syncActivity,
  discoveryRepo,
  clock: () => NOW,
  hotIntervalMs: HOT_INTERVAL_MS,
})

/**
 * The function that built an error: the first frame of its stack that is not the
 * error class's own constructor.
 */
function throwSite(error: Error): string | undefined {
  const names = (error.stack ?? '')
    .split('\n')
    .map((line) => /^\s*at (?:async )?(?:new )?([^\s(]+)/u.exec(line)?.[1])
  return names.find(
    (name) => name !== undefined && name !== 'ReviewProviderSnapshotFailure',
  )
}

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
  // alert and a repair latch on the largest Property (2026-10-19).
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

  // A failure that repeats waits longer each time (domain/snapshot-failure-backoff.ts):
  // 15 minutes, then 1 hour, 4 hours, and at most 6 hours. The tests below run
  // the real handler against the in-memory repository, one failure per hop in
  // time, and read back the retry date the repository holds.
  describe('failure backoff', () => {
    const MINUTE_MS = 60 * 1000
    const HOUR_MS = 60 * MINUTE_MS

    function failingHandler(
      rows: ReturnType<typeof fakeDiscoveryProperty>[],
      outcome: { status: 'failed'; runId: string; code: 'provider_failure' | string },
      clock: { now: Date },
    ) {
      const discoveryRepo = createFakeReviewDiscoveryRepository(rows)
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
      const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
      const clock = { now: NOW }
      const { handler } = failingHandler([row], FAILED as never, clock)
      const waits: number[] = []

      for (let failure = 0; failure < 5; failure++) {
        await failOnce(handler as never)
        waits.push((row.nextDueAt as Date).getTime() - clock.now.getTime())
        // The scheduled retry comes due and fails again.
        clock.now = row.nextDueAt as Date
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
      const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
      const clock = { now: NOW }
      const { handler } = failingHandler([row], FAILED as never, clock)

      await failOnce(handler as never)
      clock.now = row.nextDueAt as Date
      await failOnce(handler as never)

      expect(row.errorRetryAt).toEqual(row.nextDueAt)
      expect(row.lastFailureAt).toEqual(clock.now)
    })

    it('does not climb the ladder when the queue retries the same failed job before the retry came due', async () => {
      const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
      const clock = { now: NOW }
      const { handler } = failingHandler([row], FAILED as never, clock)

      await failOnce(handler as never)
      clock.now = new Date(NOW.getTime() + 2 * MINUTE_MS) // BullMQ attempt 2
      await failOnce(handler as never)
      clock.now = new Date(NOW.getTime() + 5 * MINUTE_MS) // BullMQ attempt 3
      await failOnce(handler as never)

      expect((row.nextDueAt as Date).getTime() - clock.now.getTime()).toBe(15 * MINUTE_MS)
    })

    it('starts again at 15 minutes after a completed run clears the failure', async () => {
      const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
      const clock = { now: NOW }
      const failing = failingHandler([row], FAILED as never, clock)
      await failOnce(failing.handler as never)
      clock.now = row.nextDueAt as Date
      await failOnce(failing.handler as never)
      expect(row.errorRetryAt).not.toBeNull()

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
      expect(row.errorClass).toBeNull()

      clock.now = new Date(clock.now.getTime() + HOUR_MS)
      await failOnce(failing.handler as never)
      expect((row.nextDueAt as Date).getTime() - clock.now.getTime()).toBe(15 * MINUTE_MS)
    })

    it('parks a location over the cap for a day however often it failed before', async () => {
      const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
      const clock = { now: NOW }
      const failing = failingHandler([row], FAILED as never, clock)
      await failOnce(failing.handler as never)
      clock.now = row.nextDueAt as Date

      const tooLarge = failingHandler(
        [row],
        { ...FAILED, code: 'review_cap_exceeded' } as never,
        clock,
      )
      await tooLarge.handler({ id: 'job-too-large', data: JOB_DATA } as never)

      expect((row.nextDueAt as Date).getTime() - clock.now.getTime()).toBe(24 * HOUR_MS)
    })

    it('logs the chosen interval and nothing from the payload', async () => {
      const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
      const clock = { now: NOW }
      const { handler, logger } = failingHandler([row], FAILED as never, clock)

      await failOnce(handler as never)
      clock.now = row.nextDueAt as Date
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
        const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
        const clock = { now: NOW }
        const enqueueContinuation = vi.fn(async () => undefined)
        const discoveryRepo = createFakeReviewDiscoveryRepository([row])
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
        expect(row.errorClass).toBeNull()
        expect(row.nextDueAt).toBeNull()
        expect(row.lastFailureAt).toBeNull()
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

  it('marks initial Google property import observations as historical onboarding', async () => {
    const runSnapshot = vi.fn(async () => ({
      status: 'completed' as const,
      runId: '44444444-4444-4444-8444-444444444444',
    }))
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot,
      propertySourceEpoch,
      enqueueContinuation: vi.fn(async () => undefined),
      ...ladderDeps(makeSyncActivity()),
    })

    await handler({
      id: 'job-property-import',
      data: {
        ...JOB_DATA,
        initiator: {
          kind: 'system',
          id: GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID,
        },
      },
    } as never)

    expect(runSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ observationOrigin: 'historical_onboarding' }),
    )
  })

  it('runs identifier-only targeted push work without starting a full snapshot', async () => {
    const syncActivity = makeSyncActivity()
    const runSnapshot = vi.fn()
    const runTargetedFetch = vi.fn(async () => ({
      status: 'persisted' as const,
      reviewId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as never,
      sourceRevision: 1,
      isNew: true,
    }))
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot: runSnapshot as never,
      runTargetedFetch,
      propertySourceEpoch,
      enqueueContinuation: vi.fn(async () => undefined),
      ...ladderDeps(syncActivity),
    })
    const targeted = {
      mode: 'targeted' as const,
      propertyId: JOB_DATA.propertyId,
      organizationId: JOB_DATA.organizationId,
      connectionId: JOB_DATA.connectionId,
      sourceEpoch: 7,
      referenceRef: `v1.${Buffer.alloc(32, 4).toString('base64url')}`,
      deliveryId: '55555555-5555-4555-8555-555555555555',
      acceptedAt: '2026-08-21T11:58:00.000Z',
      notificationKind: 'NEW_REVIEW' as const,
      initiator: { kind: 'system' as const, id: GBP_PUSH_SYNC_INITIATOR_ID },
      correlationId: 'gbp-push-event',
    }

    await handler({ id: 'job-targeted', data: targeted } as never)

    expect(runTargetedFetch).toHaveBeenCalledWith({
      organizationId: JOB_DATA.organizationId,
      propertyId: JOB_DATA.propertyId,
      connectionId: JOB_DATA.connectionId,
      sourceEpoch: 7,
      referenceRef: targeted.referenceRef,
      deliveryId: targeted.deliveryId,
      acceptedAt: new Date('2026-08-21T11:58:00.000Z'),
      notificationKind: 'NEW_REVIEW',
    })
    expect(runSnapshot).not.toHaveBeenCalled()
    expect(syncActivity.recordPushObserved).toHaveBeenCalledTimes(1)
  })

  describe('push health inputs of a targeted job', () => {
    const queued = {
      mode: 'targeted' as const,
      propertyId: JOB_DATA.propertyId,
      organizationId: JOB_DATA.organizationId,
      connectionId: JOB_DATA.connectionId,
      sourceEpoch: 7,
      referenceRef: null,
      deliveryId: '55555555-5555-4555-8555-555555555555',
      initiator: { kind: 'system' as const, id: GBP_PUSH_SYNC_INITIATOR_ID },
      correlationId: 'gbp-push-event',
    }
    const run = (data: Record<string, unknown>) => {
      const runTargetedFetch = vi.fn(async () => ({ status: 'obsolete' as const }))
      const handler = createSyncPropertyReviewsHandler({
        runSnapshot: vi.fn() as never,
        runTargetedFetch,
        propertySourceEpoch,
        enqueueContinuation: vi.fn(async () => undefined),
        ...ladderDeps(makeSyncActivity()),
      })
      return {
        runTargetedFetch,
        result: handler({ id: 'job-push-health', data } as never),
      }
    }

    it('judges a job queued before push health was measured by the time it starts', async () => {
      const { runTargetedFetch, result } = run(queued)

      await result

      expect(runTargetedFetch).toHaveBeenCalledWith(
        expect.objectContaining({ acceptedAt: NOW, notificationKind: 'REVIEW_CHANGED' }),
      )
    })

    it('rejects a job whose acceptance time is not an instant', async () => {
      const { runTargetedFetch, result } = run({ ...queued, acceptedAt: 'yesterday-ish' })

      await expect(result).rejects.toThrow(
        'Invalid targeted Review provider job identity',
      )
      expect(runTargetedFetch).not.toHaveBeenCalled()
    })

    it('rejects a job with a notification kind Google does not send', async () => {
      const { runTargetedFetch, result } = run({ ...queued, notificationKind: 'DELETED' })

      await expect(result).rejects.toThrow(
        'Invalid targeted Review provider job identity',
      )
      expect(runTargetedFetch).not.toHaveBeenCalled()
    })
  })

  it.each([
    [GBP_PUSH_SYNC_INITIATOR_ID, 'push_reconcile'],
    [DISCOVERY_SWEEP_SYNC_INITIATOR_ID, 'snapshot'],
  ] as const)(
    'labels the reviews a snapshot step started by %s as seen by %s',
    async (initiatorId, expected) => {
      const runSnapshot = vi.fn(async () => ({
        status: 'completed' as const,
        runId: '44444444-4444-4444-8444-444444444444',
      }))
      const handler = createSyncPropertyReviewsHandler({
        runSnapshot,
        propertySourceEpoch,
        enqueueContinuation: vi.fn(async () => undefined),
        ...ladderDeps(makeSyncActivity()),
      })

      await handler({
        id: 'job-label',
        data: { ...JOB_DATA, initiator: { kind: 'system', id: initiatorId } },
      } as never)

      expect(runSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ firstSeenVia: expected }),
      )
    },
  )

  it('enqueues one deterministic full reconciliation when a targeted reference expired', async () => {
    const enqueueContinuation = vi.fn(async () => undefined)
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot: vi.fn() as never,
      runTargetedFetch: vi.fn(async () => ({
        status: 'reconcile' as const,
        locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
        reason: 'reference_expired' as const,
      })),
      propertySourceEpoch,
      enqueueContinuation,
      ...ladderDeps(makeSyncActivity()),
    })
    const deliveryId = '66666666-6666-4666-8666-666666666666'

    await handler({
      id: 'job-targeted-reconcile',
      data: {
        mode: 'targeted',
        propertyId: JOB_DATA.propertyId,
        organizationId: JOB_DATA.organizationId,
        connectionId: JOB_DATA.connectionId,
        sourceEpoch: 7,
        referenceRef: null,
        deliveryId,
        initiator: { kind: 'system', id: GBP_PUSH_SYNC_INITIATOR_ID },
        correlationId: 'gbp-push-event',
      },
    } as never)

    expect(enqueueContinuation).toHaveBeenCalledWith(
      {
        ...JOB_DATA,
        sourceEpoch: 7,
        initiator: { kind: 'system', id: GBP_PUSH_SYNC_INITIATOR_ID },
        correlationId: 'gbp-push-event',
      },
      { jobId: `gbp-push-reconcile-${deliveryId}` },
    )
  })

  // The rate-limited checkpoint does NOT advance the cursor, so the
  // continuation repeats the same provider call. Undelayed, that is an
  // amplification loop against a provider that just asked for a pause - it was
  // measured at ~9 denials/second for a whole e2e run, starving every other
  // Google route behind the same quota.
  it('delays the continuation by the provider backoff hint', async () => {
    const runSnapshot = vi.fn(async () => ({
      status: 'checkpointed' as const,
      runId: '44444444-4444-4444-8444-444444444444',
      state: 'scanning' as const,
      retryAfterMs: 5_000,
    }))
    const enqueueContinuation = vi.fn(async () => undefined)
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot,
      propertySourceEpoch,
      enqueueContinuation,
      ...ladderDeps(makeSyncActivity()),
    })

    await handler({ id: 'job-1', data: JOB_DATA } as never)

    expect(enqueueContinuation).toHaveBeenCalledWith(
      {
        ...JOB_DATA,
        sourceEpoch: 7,
        runId: '44444444-4444-4444-8444-444444444444',
      },
      { delayMs: 5_000 },
    )
  })

  it('does not delay a deleting continuation, which makes real progress', async () => {
    const runSnapshot = vi.fn(async () => ({
      status: 'deleting' as const,
      runId: '44444444-4444-4444-8444-444444444444',
      applied: 3,
    }))
    const enqueueContinuation = vi.fn(async () => undefined)
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot,
      propertySourceEpoch,
      enqueueContinuation,
      ...ladderDeps(makeSyncActivity()),
    })

    await handler({ id: 'job-1', data: JOB_DATA } as never)

    expect(enqueueContinuation).toHaveBeenCalledWith({
      ...JOB_DATA,
      sourceEpoch: 7,
      runId: '44444444-4444-4444-8444-444444444444',
    })
  })

  it('rejects a stale source epoch before snapshot work', async () => {
    const runSnapshot = vi.fn()
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot: runSnapshot as never,
      propertySourceEpoch,
      enqueueContinuation: vi.fn(async () => undefined),
      ...ladderDeps(makeSyncActivity()),
    })

    await expect(
      handler({ id: 'job-2', data: { ...JOB_DATA, sourceEpoch: 6 } } as never),
    ).rejects.toThrow('Review provider source changed')
    expect(runSnapshot).not.toHaveBeenCalled()
  })

  // This arrange repeats verbatim in the two tests below. The handler deps are
  // the fixture, not the subject: each test varies the job's initiator (push
  // here, sweep and continuation below) and asserts a different
  // recordPushObserved outcome from it. Lifting the builder into a beforeEach
  // would share one syncActivity spy across tests whose whole subject is
  // whether that spy was called, and would put the premise off screen when one
  // of them fails. Revisit if a fourth initiator lands — then drive
  // (initiator, expectation) as a table over a single builder.
  // fallow-ignore-next-line code-duplication
  it('stamps push liveness and un-parks the next poll for a webhook-initiated sync', async () => {
    const syncActivity = makeSyncActivity()
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot: vi.fn(async () => ({
        status: 'completed' as const,
        runId: '44444444-4444-4444-8444-444444444444',
      })),
      propertySourceEpoch,
      enqueueContinuation: vi.fn(async () => undefined),
      ...ladderDeps(syncActivity),
    })

    await handler({
      id: 'job-3',
      data: {
        ...JOB_DATA,
        initiator: { kind: 'system', id: GBP_PUSH_SYNC_INITIATOR_ID },
      },
    } as never)

    expect(syncActivity.recordPushObserved).toHaveBeenCalledWith(
      JOB_DATA.propertyId,
      NOW,
      new Date(NOW.getTime() + HOT_INTERVAL_MS),
    )
  })

  // Same deliberate per-initiator builder as the webhook test above (see the
  // reasoning there): three tests share the handler-construction shape and
  // differ only in the initiator they feed it and the recordPushObserved
  // outcome they expect. A second directive is needed because the group has
  // three members — suppressing one instance still leaves the other two
  // matching each other. Retire both when the fourth initiator turns these
  // into an (initiator, expectation) table.
  // fallow-ignore-next-line code-duplication
  it('does not stamp push liveness for a sweep-initiated sync', async () => {
    const syncActivity = makeSyncActivity()
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot: vi.fn(async () => ({
        status: 'completed' as const,
        runId: '44444444-4444-4444-8444-444444444444',
      })),
      propertySourceEpoch,
      enqueueContinuation: vi.fn(async () => undefined),
      ...ladderDeps(syncActivity),
    })

    await handler({
      id: 'job-4',
      data: {
        ...JOB_DATA,
        initiator: { kind: 'system', id: 'sweep:review-discovery' },
      },
    } as never)

    expect(syncActivity.recordPushObserved).not.toHaveBeenCalled()
  })

  it('stamps push liveness once per run, not once per continuation page', async () => {
    const syncActivity = makeSyncActivity()
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot: vi.fn(async () => ({
        status: 'completed' as const,
        runId: '44444444-4444-4444-8444-444444444444',
      })),
      propertySourceEpoch,
      enqueueContinuation: vi.fn(async () => undefined),
      ...ladderDeps(syncActivity),
    })

    // A continuation carries the same initiator plus the run id.
    await handler({
      id: 'job-5',
      data: {
        ...JOB_DATA,
        sourceEpoch: 7,
        runId: '44444444-4444-4444-8444-444444444444',
        initiator: { kind: 'system', id: GBP_PUSH_SYNC_INITIATOR_ID },
      },
    } as never)

    expect(syncActivity.recordPushObserved).not.toHaveBeenCalled()
  })

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

      function snapshotHandler(rows: ReturnType<typeof fakeDiscoveryProperty>[]) {
        const discoveryRepo = createFakeReviewDiscoveryRepository(rows)
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
        const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
        const { handler, logger, enqueueContinuation, markDeferred, markSucceeded } =
          snapshotHandler([row])

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
        const row = fakeDiscoveryProperty({
          propertyId: JOB_DATA.propertyId,
          nextDueAt: dueAt,
        })
        const { discoveryRepo, handler } = snapshotHandler([row])

        await handler({ id: 'job-snapshot-unusable', data: JOB_DATA } as never)

        // No failure recorded and no wait pushed out: the backoff ladder never
        // sees a failure that only a reconnect can cure.
        expect(row.errorClass).toBeNull()
        expect(row.errorRetryAt).toBeNull()
        expect(row.lastFailureAt).toBeNull()
        expect(row.nextDueAt).toEqual(dueAt)

        // While the connection waits, the sweep does not select the Property
        // (it never enqueues a job that cannot run). Once it is reconnected the
        // Property is due on its own date and comes back as a candidate with no
        // outstanding failure.
        row.connectionStatus = 'reauth_required'
        expect(await discoveryRepo.findDuePropertiesBatch(dueAt, null, 10)).toEqual([])
        row.connectionStatus = 'active'
        const [candidate] = await discoveryRepo.findDuePropertiesBatch(dueAt, null, 10)
        expect(candidate).toMatchObject({
          propertyId: JOB_DATA.propertyId,
          hasOutstandingFailure: false,
        })
      })

      it('still records the failure and throws for authorization_denied, the refusal of a usable connection', async () => {
        const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
        const discoveryRepo = createFakeReviewDiscoveryRepository([row])
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
        expect(row.errorClass).toBe('authorization_denied')
      })
    })
  })

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

    function replayHandler(
      outcomes: readonly unknown[],
      row: ReturnType<typeof fakeDiscoveryProperty>,
      clock: { now: Date } = { now: NOW },
    ) {
      const discoveryRepo = createFakeReviewDiscoveryRepository([row])
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
      fakeDiscoveryProperty({
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
        const before = { ...row }
        const { handler, enqueueContinuation, markDeferred, markSucceeded } =
          replayHandler([replay(code)], row)

        await expect(handler({ id: 'job-replay', data: STEP } as never)).resolves.toEqual(
          SKIPPED,
        )

        expect(markDeferred).not.toHaveBeenCalled()
        expect(markSucceeded).not.toHaveBeenCalled()
        expect(enqueueContinuation).not.toHaveBeenCalled()
        expect(row).toEqual(before)
        expect(mocks.capture).not.toHaveBeenCalled()
      },
    )

    it('writes one warning of closed codes and names no tenant identifier', async () => {
      const { handler, logger } = replayHandler(
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

    // The beta on 2026-10-24: a VACUUM FULL held a lock, one step's observation
    // write timed out and failed its run, and every retry of that step failed
    // the job again until it was dead-lettered.
    it('fails the job for the step that failed the run, and only for that step', async () => {
      const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
      const clock = { now: NOW }
      const { handler, markDeferred, logger } = replayHandler(
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
      const earned = { ...row }
      expect((row.nextDueAt as Date).getTime() - NOW.getTime()).toBe(HOT_INTERVAL_MS)

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
      expect(row).toEqual(earned)
      expect(
        logger.warn.mock.calls.filter(
          ([fields]) => fields.event === 'review_snapshot_failure_deferred',
        ),
      ).toHaveLength(1)
      // One failure, one report: the replays added none.
      expect(mocks.capture).toHaveBeenCalledTimes(1)
    })

    it('records the failure and throws when the run fails in this very step', async () => {
      const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
      const { handler, markDeferred, logger } = replayHandler(
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
      expect(row.errorClass).toBe('provider_failure')
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
        const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
        const { handler, markDeferred } = replayHandler([fresh(code)], row)

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
        expect(row.errorClass).toBe(code)
      },
    )

    // Error monitoring has no fingerprint of its own here (the scrub deletes it),
    // so it groups by stack, and the existing ReviewProviderSnapshotFailure issue
    // (JAVASCRIPT-TANSTACKSTART-REACT-4) was grouped under runSnapshotStep, the
    // function that built the error before the explicit report. A helper that
    // builds it moves the frame and the report would open a new issue.
    it.each([
      ['a step that continues a run', STEP],
      ['the first step of a run', JOB_DATA],
    ])(
      'builds the error of %s in runSnapshotStep, where its issue is grouped',
      async (_name, data) => {
        const { handler } = replayHandler(
          [fresh('observation_failed')],
          fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId }),
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
      const { handler } = replayHandler(
        [fresh('observation_failed')],
        fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId }),
      )

      const failure = await handler({ id: 'job-retryable', data: STEP } as never).catch(
        (err: unknown) => err,
      )

      expect(isTerminalFailedEvent(afterAttempt(1), failure)).toBe(false)
    })

    // A location over the cap is parked and the job ends normally: nothing
    // throws, so nothing is reported, as before the run id mattered.
    it('does not report a location parked for being over the cap', async () => {
      const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
      const { handler } = replayHandler([fresh('review_cap_exceeded')], row)

      await expect(handler({ id: 'job-cap', data: STEP } as never)).resolves.toEqual(
        fresh('review_cap_exceeded'),
      )

      expect(mocks.capture).not.toHaveBeenCalled()
    })

    // The first step of a run has no run id: its retry starts a new run, which
    // can succeed, so it keeps its attempts and is terminal when they are spent.
    it('keeps the failure of the first step of a run retryable until its attempts are spent', async () => {
      const { handler } = replayHandler(
        [fresh('observation_failed')],
        fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId }),
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
      const { handler } = replayHandler(
        [fresh('observation_failed')],
        fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId }),
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
        const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
        const clock = { now: new Date(NOW.getTime() + 30 * 1000) }
        const { handler, markDeferred, logger } = replayHandler(
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
        expect(row.errorClass).toBe('observation_failed')
        expect(
          logger.warn.mock.calls.filter(
            ([fields]) => fields.event === 'review_snapshot_failure_deferred',
          ),
        ).toHaveLength(1)
        expect(mocks.capture).not.toHaveBeenCalled()
      })

      it('records it when the Property holds only an older failure, climbing the ladder', async () => {
        const olderFailureAt = new Date(NOW.getTime() - 2 * 60 * MINUTE_MS)
        const row = fakeDiscoveryProperty({
          propertyId: JOB_DATA.propertyId,
          errorClass: 'provider_failure',
          lastFailureAt: olderFailureAt,
          errorRetryAt: new Date(olderFailureAt.getTime() + HOT_INTERVAL_MS),
          nextDueAt: new Date(olderFailureAt.getTime() + HOT_INTERVAL_MS),
        })
        const { handler, markDeferred } = replayHandler(
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
        const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
        const { handler, markDeferred } = replayHandler(
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
        const row = fakeDiscoveryProperty({
          propertyId: JOB_DATA.propertyId,
          errorClass: null,
          lastFailureAt: NOW,
          errorRetryAt: null,
        })
        const { handler, markDeferred } = replayHandler(
          [replay('observation_failed', new Date(NOW.getTime() - MINUTE_MS))],
          row,
        )

        await expect(handler({ id: 'job-late', data: STEP } as never)).resolves.toEqual(
          SKIPPED,
        )

        expect(markDeferred).not.toHaveBeenCalled()
        expect(row.errorClass).toBeNull()
      })

      it('records nothing when the store has no date for the run and the Property holds a failure', async () => {
        const row = failedRow()
        const before = { ...row }
        const { handler, markDeferred } = replayHandler(
          [replay('observation_failed', null)],
          row,
        )

        await expect(
          handler({ id: 'job-undated', data: STEP } as never),
        ).resolves.toEqual(SKIPPED)

        expect(markDeferred).not.toHaveBeenCalled()
        expect(row).toEqual(before)
      })
    })

    it('leaves a location parked for being over the cap parked', async () => {
      const parkedUntil = new Date(NOW.getTime() + 24 * 60 * MINUTE_MS)
      const row = fakeDiscoveryProperty({
        propertyId: JOB_DATA.propertyId,
        errorClass: 'review_cap_exceeded',
        lastFailureAt: NOW,
        errorRetryAt: parkedUntil,
        nextDueAt: parkedUntil,
      })
      const { handler, markDeferred } = replayHandler(
        [replay('review_cap_exceeded')],
        row,
      )

      await expect(handler({ id: 'job-parked', data: STEP } as never)).resolves.toEqual(
        SKIPPED,
      )

      expect(markDeferred).not.toHaveBeenCalled()
      expect(row.nextDueAt).toEqual(parkedUntil)
    })

    // The step that lost the run may have died before it queued the fresh one
    // (a Redis blip on the enqueue): its retry is the only thing that does.
    it.each(['cursor_lost', 'listing_changed'] as const)(
      'still starts the fresh run when it finds the run lost as %s',
      async (code) => {
        const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
        const { handler, enqueueContinuation, markDeferred } = replayHandler(
          [replay(code)],
          row,
        )

        await expect(
          handler({ id: 'job-restart', data: STEP } as never),
        ).resolves.not.toEqual(SKIPPED)

        expect(enqueueContinuation).toHaveBeenCalledTimes(1)
        expect(enqueueContinuation).toHaveBeenCalledWith({ ...JOB_DATA, sourceEpoch: 7 })
        expect(markDeferred).not.toHaveBeenCalled()
        expect(row.errorClass).toBeNull()
      },
    )

    it('keeps the reconnect skip for a run that failed as connection_unusable', async () => {
      const { handler, logger, markDeferred } = replayHandler(
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
