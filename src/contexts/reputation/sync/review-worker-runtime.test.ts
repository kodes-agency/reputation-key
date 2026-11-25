import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import type { Database } from '#/shared/db'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { registerReviewWorkerJobs } from './review-worker-runtime.server'
import { JOB_NAME as SYNC_REVIEWS_JOB_NAME } from './sync-property-reviews-job.server'
import { JOB_NAME as REFRESH_EXPIRING_JOB_NAME } from './refresh-expiring-reviews-job.server'
import { JOB_NAME as DISCOVER_NEW_REVIEWS_JOB_NAME } from './discover-new-reviews-job.server'
import { JOB_NAME as PURGE_EXPIRED_JOB_NAME } from '../content/purge-expired-reviews-job.server'
import { JOB_NAME as PUBLISH_REPLY_JOB_NAME } from '../publication/publish-reply-job.server'
import {
  EXPIRE_REVIEW_PROVIDER_SOURCE_JOB_NAME,
  SWEEP_REVIEW_PROVIDER_TOMBSTONES_JOB_NAME,
} from '../content/review-provider-lifecycle-sweeps-job.server'
import { JOB_NAME as RECONCILE_AMBIGUOUS_JOB_NAME } from '../publication/reconcile-ambiguous-publications-job.server'

describe('registerReviewWorkerJobs', () => {
  it('contributes the complete Review job family to the caller-owned registry', async () => {
    const registered: string[] = []

    await registerReviewWorkerJobs({
      db: {} as Database,
      pool: {} as Pool,
      registry: {
        register: (name) => {
          registered.push(name)
        },
      },
      backgroundQueue: { add: vi.fn() },
      reviewQueue: { addSyncJob: vi.fn() } as never,
      reviewRepo: {} as never,
      replyRepo: {} as never,
      replyCommandStore: {} as never,
      googleReviewApi: {} as never,
      googleConnectionStatus: { findStatus: async () => null },
      staffPublicApi: {
        getAccessiblePropertyIds: vi.fn(),
        getAssignedPortals: vi.fn(),
      },
      propertySourceEpoch: { getSourceEpoch: vi.fn() },
      runSnapshot: vi.fn(),
      runTargetedFetch: vi.fn(),
      readReviewBeforePublish: vi.fn(),
      runSourceContentLifecycle: vi.fn(),
      reconcileReplyPublication: vi.fn(),
      dispatchEvidence: { findDispatchEvidence: vi.fn() },
      clock: () => new Date('2026-08-28T00:00:00.000Z'),
      idGen: () => '00000000-0000-4000-8000-000000000001',
      logger: createMockLogger(),
      discoveryIntervalMs: 15 * 60 * 1_000,
      discoverySkipRecentlyReconciled: true,
      headChecks: 'dark',
      reconcileWithinMs: 6 * 60 * 60 * 1_000,
      headCheckQueue: { addHeadCheckJob: vi.fn() },
      observationWriter: {
        allocateReplyReadGeneration: vi.fn(),
        persist: vi.fn(),
      },
      subjectKeyService: {} as never,
      subjectSightings: {} as never,
    })

    expect(registered.sort()).toEqual(
      [
        SYNC_REVIEWS_JOB_NAME,
        EXPIRE_REVIEW_PROVIDER_SOURCE_JOB_NAME,
        SWEEP_REVIEW_PROVIDER_TOMBSTONES_JOB_NAME,
        REFRESH_EXPIRING_JOB_NAME,
        DISCOVER_NEW_REVIEWS_JOB_NAME,
        PURGE_EXPIRED_JOB_NAME,
        PUBLISH_REPLY_JOB_NAME,
        RECONCILE_AMBIGUOUS_JOB_NAME,
      ].sort(),
    )
    expect(new Set(registered).size).toBe(registered.length)
  })
})
