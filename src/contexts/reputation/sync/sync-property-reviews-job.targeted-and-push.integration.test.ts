import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DISCOVERY_SWEEP_SYNC_INITIATOR_ID,
  GBP_PUSH_SYNC_INITIATOR_ID,
  GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID,
} from './review-queue.port.server'
import { createSyncPropertyReviewsHandler } from './sync-property-reviews-job.server'
import {
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

describe('sync-property-reviews snapshot handler', () => {
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
})
