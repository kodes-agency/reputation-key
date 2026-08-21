import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, expect, it, vi } from 'vitest'
import { GBP_PUSH_SYNC_INITIATOR_ID } from '../../application/ports/review-queue.port'
import type { ReviewSyncActivityRecorder } from '../../application/ports/review-sync-activity.port'
import { createSyncPropertyReviewsHandler } from './sync-property-reviews.job'

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

const NOW = new Date('2026-08-21T12:00:00.000Z')
const HOT_INTERVAL_MS = 15 * 60 * 1000

const JOB_DATA = {
  propertyId: '11111111-1111-4111-8111-111111111111',
  organizationId: '33333333-3333-4333-8333-333333333333',
  connectionId: '22222222-2222-4222-8222-222222222222',
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
}

const propertyRouting = {
  getProcessingScope: vi.fn(async () => ({ processingRegion: 'global', sourceEpoch: 7 })),
}

const makeSyncActivity = (): ReviewSyncActivityRecorder => ({
  recordNewReviewObserved: vi.fn(async () => undefined),
  recordPushObserved: vi.fn(async () => undefined),
})

const ladderDeps = (syncActivity: ReviewSyncActivityRecorder) => ({
  syncActivity,
  clock: () => NOW,
  hotIntervalMs: HOT_INTERVAL_MS,
})

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
      propertyRouting,
      enqueueContinuation,
      ...ladderDeps(makeSyncActivity()),
    })

    await handler({ id: 'job-1', data: JOB_DATA } as never)

    expect(runSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEpoch: 7,
        locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      }),
    )
    expect(enqueueContinuation).toHaveBeenCalledWith({
      ...JOB_DATA,
      sourceEpoch: 7,
      runId: '44444444-4444-4444-8444-444444444444',
    })
    expect(JSON.stringify(enqueueContinuation.mock.calls)).not.toContain('pageToken')
  })

  it('rejects a stale source epoch before snapshot work', async () => {
    const runSnapshot = vi.fn()
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot: runSnapshot as never,
      propertyRouting,
      enqueueContinuation: vi.fn(async () => undefined),
      ...ladderDeps(makeSyncActivity()),
    })

    await expect(
      handler({ id: 'job-2', data: { ...JOB_DATA, sourceEpoch: 6 } } as never),
    ).rejects.toThrow('Review provider source changed')
    expect(runSnapshot).not.toHaveBeenCalled()
  })

  it('stamps push liveness and un-parks the next poll for a webhook-initiated sync', async () => {
    const syncActivity = makeSyncActivity()
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot: vi.fn(async () => ({
        status: 'completed' as const,
        runId: '44444444-4444-4444-8444-444444444444',
      })),
      propertyRouting,
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

  it('does not stamp push liveness for a sweep-initiated sync', async () => {
    const syncActivity = makeSyncActivity()
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot: vi.fn(async () => ({
        status: 'completed' as const,
        runId: '44444444-4444-4444-8444-444444444444',
      })),
      propertyRouting,
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
      propertyRouting,
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
