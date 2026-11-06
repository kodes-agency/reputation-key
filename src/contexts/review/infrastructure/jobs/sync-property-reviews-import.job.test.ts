import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, expect, it, vi } from 'vitest'
import { GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID } from '../../application/ports/review-queue.port'
import {
  createFakeReviewDiscoveryRepository,
  fakeDiscoveryProperty,
} from '#/shared/testing/fake-review-discovery-repository'
import { createSyncPropertyReviewsHandler } from './sync-property-reviews.job'

vi.mock('#/shared/observability/trace', () => ({
  trace: (_name: string, fn: () => unknown) => fn(),
}))

const NOW = new Date('2026-08-21T12:00:00.000Z')
const JOB_DATA = {
  propertyId: '11111111-1111-4111-8111-111111111111',
  organizationId: '33333333-3333-4333-8333-333333333333',
  connectionId: '22222222-2222-4222-8222-222222222222',
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
}
const propertySourceEpoch = { getSourceEpoch: async () => ({ sourceEpoch: 7 }) }
const makeSyncActivity = () => ({
  recordNewReviewObserved: vi.fn(),
  recordPushObserved: vi.fn(),
})
const ladderDeps = (
  syncActivity: ReturnType<typeof makeSyncActivity>,
  discoveryRepo = createFakeReviewDiscoveryRepository([]),
) => ({
  syncActivity,
  discoveryRepo,
  clock: () => NOW,
  hotIntervalMs: 15 * 60 * 1000,
})

describe('durable initial import sync jobs', () => {
  it.each(['cursor_lost', 'listing_changed'] as const)(
    'acknowledges the replacement import run after %s before enqueueing its next page',
    async (code) => {
      const lostRun = '44444444-4444-4444-8444-444444444444'
      const newRun = '55555555-5555-4555-8555-555555555555'
      const initial = {
        ...JOB_DATA,
        sourceEpoch: 7,
        runId: lostRun,
        importBindingEventId: '66666666-6666-4666-8666-666666666666',
        initiator: {
          kind: 'system' as const,
          id: GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID,
        },
      }
      const runSnapshot = vi
        .fn()
        .mockResolvedValueOnce({ status: 'failed', runId: lostRun, code })
        .mockResolvedValueOnce({
          status: 'checkpointed',
          runId: newRun,
          state: 'scanning',
        })
      const steps: (typeof initial)[] = []
      const acknowledgeImportSync = vi.fn(async (data) => {
        // The durable acceptance boundary requires the run which committed progress.
        expect(data.runId).toBe(newRun)
      })
      const handler = createSyncPropertyReviewsHandler({
        runSnapshot,
        propertySourceEpoch,
        acknowledgeImportSync,
        enqueueContinuation: async (data) => {
          steps.push(data as typeof initial)
        },
        ...ladderDeps(makeSyncActivity()),
      })
      await handler({ data: initial } as never)
      expect(acknowledgeImportSync).not.toHaveBeenCalled()
      expect(steps[0]).toEqual(
        expect.objectContaining({ importBindingEventId: initial.importBindingEventId }),
      )
      expect(steps[0]).not.toHaveProperty('runId')
      await handler({ data: steps.shift()! } as never)
      expect(acknowledgeImportSync).toHaveBeenCalledTimes(1)
      expect(steps).toEqual([{ ...initial, runId: newRun }])
    },
  )

  it.each(['review_cap_exceeded', 'provider_rejected'] as const)(
    'acknowledges an initial %s only after Review records its retry schedule',
    async (code) => {
      const row = fakeDiscoveryProperty({ propertyId: JOB_DATA.propertyId })
      const discoveryRepo = createFakeReviewDiscoveryRepository([row])
      const acknowledgeImportSync = vi.fn(async () => {
        expect(row.errorClass).toBe(code)
        expect(row.errorRetryAt!.getTime()).toBeGreaterThan(NOW.getTime())
      })
      const enqueueContinuation = vi.fn()
      const handler = createSyncPropertyReviewsHandler({
        runSnapshot: async () => ({
          status: 'failed',
          code,
          runId: '44444444-4444-4444-8444-444444444444',
        }),
        propertySourceEpoch,
        acknowledgeImportSync,
        enqueueContinuation,
        ...ladderDeps(makeSyncActivity(), discoveryRepo),
      })
      await handler({
        data: {
          ...JOB_DATA,
          importBindingEventId: '66666666-6666-4666-8666-666666666666',
        },
      } as never)
      expect(acknowledgeImportSync).toHaveBeenCalledTimes(1)
      expect(enqueueContinuation).not.toHaveBeenCalled()
      if (code === 'review_cap_exceeded')
        expect(row.errorRetryAt).toEqual(new Date(NOW.getTime() + 86_400_000))
    },
  )
})
