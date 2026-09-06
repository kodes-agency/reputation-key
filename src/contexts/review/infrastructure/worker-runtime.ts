import type { Job, Queue } from 'bullmq'
import type { Pool } from 'pg'
import type { Database } from '#/shared/db'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { JobRegistry } from '#/shared/jobs/registry'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import { replyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { ReviewRepository } from '../application/ports/review.repository'
import type { ReplyRepository } from '../application/ports/reply.repository'
import type { ReplyCommandStore } from '../application/ports/reply-command-store.port'
import type { ReviewQueuePort } from '../application/ports/review-queue.port'
import type { GoogleReviewApiPort } from '../application/ports/google-review-api.port'
import {
  createSyncPropertyReviewsHandler,
  JOB_NAME as SYNC_REVIEWS_JOB_NAME,
} from './jobs/sync-property-reviews.job'
import {
  createRefreshExpiringReviewsHandler,
  JOB_NAME as REFRESH_EXPIRING_JOB_NAME,
} from './jobs/refresh-expiring-reviews.job'
import {
  createDiscoverNewReviewsHandler,
  JOB_NAME as DISCOVER_NEW_REVIEWS_JOB_NAME,
} from './jobs/discover-new-reviews.job'
import { createReviewDiscoveryRepository } from './repositories/review-discovery.repository'
import { createReviewSyncActivityRecorder } from './repositories/review-sync-activity.repository'
import { createReviewRefreshRunRepository } from './repositories/review-refresh-run.repository'
import {
  createPurgeExpiredReviewsHandler,
  JOB_NAME as PURGE_EXPIRED_JOB_NAME,
  type PurgeExpiredReviewsJobData,
} from './jobs/purge-expired-reviews.job'
import {
  createPublishReplyHandler,
  JOB_NAME as PUBLISH_REPLY_JOB_NAME,
} from './jobs/publish-reply.job'
import { createGoogleReplyObservationStore } from './google-reply-observation-store'
import { createPublicationReconciliationRunLease } from './publication-reconciliation-run-lease'
import {
  createExpireReviewProviderSourceHandler,
  createSweepReviewProviderTombstonesHandler,
  EXPIRE_REVIEW_PROVIDER_SOURCE_JOB_NAME,
  SWEEP_REVIEW_PROVIDER_TOMBSTONES_JOB_NAME,
  type ReviewProviderLifecycleSweepJobData,
} from './jobs/review-provider-lifecycle-sweeps.job'
import { createReviewProviderSnapshotRepository } from './repositories/review-provider-snapshot.repository'
import {
  createReconcileAmbiguousPublicationsHandler,
  JOB_NAME as RECONCILE_AMBIGUOUS_JOB_NAME,
} from './jobs/reconcile-ambiguous-publications.job'

type SyncHandlerDependencies = Parameters<typeof createSyncPropertyReviewsHandler>[0]
type PurgeHandlerDependencies = Parameters<typeof createPurgeExpiredReviewsHandler>[0]
type ReconcileHandlerDependencies = Parameters<
  typeof createReconcileAmbiguousPublicationsHandler
>[0]

export type ReviewWorkerRegistrationInput = Readonly<{
  db: Database
  pool: Pool
  registry: Pick<JobRegistry, 'register'>
  backgroundQueue: Pick<Queue, 'add'> | undefined
  reviewQueue: ReviewQueuePort
  reviewRepo: ReviewRepository
  replyRepo: ReplyRepository
  replyCommandStore: ReplyCommandStore
  googleReviewApi: GoogleReviewApiPort
  staffPublicApi: StaffPublicApi
  propertyRouting: SyncHandlerDependencies['propertyRouting']
  runSnapshot: SyncHandlerDependencies['runSnapshot']
  runTargetedFetch: SyncHandlerDependencies['runTargetedFetch']
  runSourceContentLifecycle: PurgeHandlerDependencies['runLifecycle']
  reconcileReplyPublication: ReconcileHandlerDependencies['reconcileReplyPublication']
  clock: () => Date
  idGen: () => string
  logger: LoggerPort
  discoveryIntervalMs: number
}>

/**
 * Register Review-owned worker handlers against the root's one canonical job
 * registry. The caller supplies infrastructure and parsed config; no repository
 * or queue escapes this context-owned registration boundary.
 */
export async function registerReviewWorkerJobs(
  input: ReviewWorkerRegistrationInput,
): Promise<void> {
  const reviewDiscovery = createReviewDiscoveryRepository(input.db)
  const reviewSyncActivity = createReviewSyncActivityRecorder(input.db)
  const syncReviewsHandler = createSyncPropertyReviewsHandler({
    runSnapshot: input.runSnapshot,
    runTargetedFetch: input.runTargetedFetch,
    propertyRouting: input.propertyRouting,
    enqueueContinuation: async (data, options) => {
      await input.reviewQueue.addSyncJob(
        data,
        options === undefined
          ? undefined
          : {
              ...(options.delayMs === undefined ? {} : { delayMs: options.delayMs }),
              ...(options.jobId === undefined ? {} : { jobId: options.jobId }),
            },
      )
    },
    syncActivity: reviewSyncActivity,
    discoveryRepo: reviewDiscovery,
    clock: input.clock,
    hotIntervalMs: input.discoveryIntervalMs,
  })
  input.registry.register(SYNC_REVIEWS_JOB_NAME, async (job) => {
    await syncReviewsHandler(
      job as Job<import('../application/ports/review-queue.port').ReviewProviderJobData>,
    )
  })
  input.logger.info(
    { job: SYNC_REVIEWS_JOB_NAME },
    'registered sync-property-reviews job handler',
  )

  const reviewProviderSnapshotRepository = createReviewProviderSnapshotRepository(
    input.db,
    input.idGen,
  )
  const enqueueProviderLifecycleContinuation = async (
    jobName:
      | typeof EXPIRE_REVIEW_PROVIDER_SOURCE_JOB_NAME
      | typeof SWEEP_REVIEW_PROVIDER_TOMBSTONES_JOB_NAME,
    data: ReviewProviderLifecycleSweepJobData,
  ): Promise<void> => {
    if (!input.backgroundQueue) {
      throw new Error('Review provider lifecycle queue is unavailable')
    }
    await input.backgroundQueue.add(jobName, data, {
      jobId: `${jobName}-${data.beforeOrAtEpochMillis}-${data.afterReviewId ?? 'start'}`,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      ...jobEnqueueOptions(jobName),
    })
  }
  const lifecycleDependencies = {
    repository: reviewProviderSnapshotRepository,
    enqueueExpiryContinuation: (data: ReviewProviderLifecycleSweepJobData) =>
      enqueueProviderLifecycleContinuation(EXPIRE_REVIEW_PROVIDER_SOURCE_JOB_NAME, data),
    enqueueTombstoneContinuation: (data: ReviewProviderLifecycleSweepJobData) =>
      enqueueProviderLifecycleContinuation(
        SWEEP_REVIEW_PROVIDER_TOMBSTONES_JOB_NAME,
        data,
      ),
  }
  const expireReviewProviderSourceHandler =
    createExpireReviewProviderSourceHandler(lifecycleDependencies)
  const sweepReviewProviderTombstonesHandler =
    createSweepReviewProviderTombstonesHandler(lifecycleDependencies)
  input.registry.register(EXPIRE_REVIEW_PROVIDER_SOURCE_JOB_NAME, async (job) => {
    await expireReviewProviderSourceHandler(
      job as Job<ReviewProviderLifecycleSweepJobData>,
    )
  })
  input.registry.register(SWEEP_REVIEW_PROVIDER_TOMBSTONES_JOB_NAME, async (job) => {
    await sweepReviewProviderTombstonesHandler(
      job as Job<ReviewProviderLifecycleSweepJobData>,
    )
  })
  input.logger.info(
    {
      jobs: [
        EXPIRE_REVIEW_PROVIDER_SOURCE_JOB_NAME,
        SWEEP_REVIEW_PROVIDER_TOMBSTONES_JOB_NAME,
      ],
    },
    'registered Review provider lifecycle handlers',
  )

  const refreshHandler = createRefreshExpiringReviewsHandler({
    reviewRepo: input.reviewRepo,
    queue: input.reviewQueue,
    refreshRunRepo: createReviewRefreshRunRepository(input.db),
    clock: input.clock,
    logger: input.logger,
  })
  input.registry.register(REFRESH_EXPIRING_JOB_NAME, async (job) => {
    await refreshHandler(job)
  })
  input.logger.info(
    { job: REFRESH_EXPIRING_JOB_NAME },
    'registered refresh-expiring-reviews job handler',
  )

  const discoverHandler = createDiscoverNewReviewsHandler({
    discoveryRepo: reviewDiscovery,
    queue: input.reviewQueue,
    clock: input.clock,
    logger: input.logger,
    intervalMs: input.discoveryIntervalMs,
  })
  input.registry.register(DISCOVER_NEW_REVIEWS_JOB_NAME, async (job) => {
    await discoverHandler(job)
  })
  input.logger.info(
    { job: DISCOVER_NEW_REVIEWS_JOB_NAME },
    'registered discover-new-reviews job handler',
  )

  const purgeHandler = createPurgeExpiredReviewsHandler({
    runLifecycle: input.runSourceContentLifecycle,
    logger: input.logger,
    enqueueContinuation: async (data) => {
      if (!input.backgroundQueue || data.checkpoint == null) {
        throw new Error('Review lifecycle continuation queue is unavailable')
      }
      await input.backgroundQueue.add(PURGE_EXPIRED_JOB_NAME, data, {
        ...jobEnqueueOptions(PURGE_EXPIRED_JOB_NAME),
        jobId: [
          'review-lifecycle-v1',
          data.mode ?? 'report',
          Date.parse(data.checkpoint.evaluatedAt),
          Date.parse(data.checkpoint.after.createdAt),
          data.checkpoint.after.reviewId,
        ].join('-'),
      })
    },
  })
  input.registry.register(PURGE_EXPIRED_JOB_NAME, async (job) => {
    await purgeHandler(job as Job<PurgeExpiredReviewsJobData>)
  })
  input.logger.info(
    { job: PURGE_EXPIRED_JOB_NAME },
    'registered quarantined purge-expired-reviews job handler',
  )

  const publishReplyHandler = createPublishReplyHandler({
    replyRepo: input.replyRepo,
    reviewRepo: input.reviewRepo,
    googleReviewApi: input.googleReviewApi,
    googleReplyObservationStore: createGoogleReplyObservationStore(input.db),
    replyCommandStore: input.replyCommandStore,
    clock: input.clock,
    logger: input.logger,
    idGen: () => replyId(input.idGen()),
    staffPublicApi: input.staffPublicApi,
  })
  input.registry.register(PUBLISH_REPLY_JOB_NAME, async (job) => {
    await publishReplyHandler(
      job as Job<import('../application/ports/reply-queue.port').PublishReplyJobData>,
    )
  })
  input.logger.info(
    { job: PUBLISH_REPLY_JOB_NAME },
    'registered publish-reply job handler',
  )

  const reconcileAmbiguousHandler = createReconcileAmbiguousPublicationsHandler({
    replyRepo: input.replyRepo,
    reconcileReplyPublication: input.reconcileReplyPublication,
    clock: input.clock,
    logger: input.logger,
    runLease: createPublicationReconciliationRunLease(input.pool),
  })
  input.registry.register(RECONCILE_AMBIGUOUS_JOB_NAME, async (job) => {
    await reconcileAmbiguousHandler(job)
  })
  input.logger.info(
    { job: RECONCILE_AMBIGUOUS_JOB_NAME },
    'registered reconcile-ambiguous-publications job handler',
  )
}
