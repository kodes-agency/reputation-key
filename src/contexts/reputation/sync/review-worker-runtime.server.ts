import { acceptGoogleImportSync } from './google-import-sync-acceptance.server'
import type { Job, Queue } from 'bullmq'
import type { Pool } from 'pg'
import type { Database } from '#/shared/db'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { JobRegistry } from '#/shared/jobs/registry'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import { replyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import type { ReviewRepository } from '../reviews/review-repository.port.server'
import type { ReplyRepository } from '../replies/reply-repository.port.server'
import type { ReplyCommandStore } from '../replies/reply-command-store.port.server'
import type {
  ReviewHeadCheckQueuePort,
  ReviewQueuePort,
} from './review-queue.port.server'
import type { ReviewHeadChecksMode } from '../domain/head-check'
import type { ReviewProviderObservationWriter } from './sync-reviews.port.server'
import type { ReviewProviderSubjectSightings } from './review-provider-subject-link.port.server'
import type { ReviewProviderSubjectKeyService } from './provider-subject-keyring.server'
import { createRunReviewHeadCheck } from './run-review-head-check.server'
import type {
  GoogleConnectionStatusPort,
  GoogleReviewApiPort,
} from './google-review-api.port.server'
import type { ReplyPublicationDispatchEvidencePort } from '../publication/reply-publication-dispatch-evidence.port.server'
import type { ReadReviewBeforePublish } from '../publication/read-review-before-publish.server'
import {
  createSyncPropertyReviewsHandler,
  JOB_NAME as SYNC_REVIEWS_JOB_NAME,
} from './sync-property-reviews-job.server'
import {
  createRefreshExpiringReviewsHandler,
  JOB_NAME as REFRESH_EXPIRING_JOB_NAME,
} from './refresh-expiring-reviews-job.server'
import {
  createDiscoverNewReviewsHandler,
  JOB_NAME as DISCOVER_NEW_REVIEWS_JOB_NAME,
} from './discover-new-reviews-job.server'
import { createReviewDiscoveryRepository } from './review-discovery-repository.server'
import { createReviewHeadCheckRepository } from './review-head-check-repository.server'
import { createReviewSyncActivityRecorder } from './review-sync-activity-repository.server'
import { createReviewRefreshRunRepository } from './review-refresh-run-repository.server'
import {
  createPurgeExpiredReviewsHandler,
  JOB_NAME as PURGE_EXPIRED_JOB_NAME,
  type PurgeExpiredReviewsJobData,
} from '../content/purge-expired-reviews-job.server'
import {
  createPublishReplyHandler,
  JOB_NAME as PUBLISH_REPLY_JOB_NAME,
} from '../publication/publish-reply-job.server'
import { createGoogleReplyObservationStore } from '../publication/google-reply-observation-store.server'
import { createPublicationReconciliationRunLease } from '../publication/publication-reconciliation-run-lease.server'
import {
  expireReviewProviderSourceHandler,
  sweepReviewProviderTombstonesHandler,
  EXPIRE_REVIEW_PROVIDER_SOURCE_JOB_NAME,
  SWEEP_REVIEW_PROVIDER_TOMBSTONES_JOB_NAME,
  type ReviewProviderLifecycleSweepJobData,
} from '../content/review-provider-lifecycle-sweeps-job.server'
import {
  createReconcileAmbiguousPublicationsHandler,
  JOB_NAME as RECONCILE_AMBIGUOUS_JOB_NAME,
} from '../publication/reconcile-ambiguous-publications-job.server'

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
  googleConnectionStatus: GoogleConnectionStatusPort
  staffPublicApi: StaffPublicApi
  propertySourceEpoch: SyncHandlerDependencies['propertySourceEpoch']
  runSnapshot: SyncHandlerDependencies['runSnapshot']
  runTargetedFetch: SyncHandlerDependencies['runTargetedFetch']
  /** The publish job's read of Google before it claims a fresh publication. */
  readReviewBeforePublish: ReadReviewBeforePublish
  runSourceContentLifecycle: PurgeHandlerDependencies['runLifecycle']
  expiryApplyConfirmation?: PurgeHandlerDependencies['scheduledApplyConfirmation']
  reconcileReplyPublication: ReconcileHandlerDependencies['reconcileReplyPublication']
  /** D4: the same non-dispatch evidence reader the manager commands use. */
  dispatchEvidence: ReplyPublicationDispatchEvidencePort
  clock: () => Date
  idGen: () => string
  logger: LoggerPort
  discoveryIntervalMs: number
  /** Discovery skips a look for a Property reconciled inside six hours. */
  discoverySkipRecentlyReconciled: boolean
  /** What a skipped look is followed by: a head check (dark or persisting), or nothing. */
  headChecks: ReviewHeadChecksMode
  /** How recent a completed reconciliation must be for a look to skip, in ms. */
  reconcileWithinMs: number
  headCheckQueue: ReviewHeadCheckQueuePort
  /** What a persisting head check writes through (unused while `headChecks` is not `persist`). */
  observationWriter: ReviewProviderObservationWriter
  subjectKeyService: ReviewProviderSubjectKeyService
  subjectSightings: ReviewProviderSubjectSightings
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
    acknowledgeImportSync: (data) => acceptGoogleImportSync(input.db, data),
    runTargetedFetch: input.runTargetedFetch,
    propertySourceEpoch: input.propertySourceEpoch,
    enqueueContinuation: input.reviewQueue.addSyncJob,
    runHeadCheck: createRunReviewHeadCheck({
      googleReviewApi: input.googleReviewApi,
      repository: createReviewHeadCheckRepository(input.db),
      logger: input.logger,
      clock: input.clock,
      persist: {
        observationWriter: input.observationWriter,
        subjectKeyService: input.subjectKeyService,
        subjectSightings: input.subjectSightings,
        propertySourceEpoch: input.propertySourceEpoch,
        syncActivity: reviewSyncActivity,
        newId: input.idGen,
      },
    }),
    headChecks: input.headChecks,
    logger: input.logger,
    syncActivity: reviewSyncActivity,
    discoveryRepo: reviewDiscovery,
    clock: input.clock,
    hotIntervalMs: input.discoveryIntervalMs,
  })
  input.registry.register(SYNC_REVIEWS_JOB_NAME, async (job) => {
    await syncReviewsHandler(
      job as Job<import('./review-queue.port.server').ReviewProviderJobData>,
    )
  })
  input.logger.info(
    { job: SYNC_REVIEWS_JOB_NAME },
    'registered sync-property-reviews job handler',
  )

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
    discoveryRepo: reviewDiscovery,
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
    skipRecentlyReconciled: input.discoverySkipRecentlyReconciled,
    headChecks: input.headChecks,
    reconcileWithinMs: input.reconcileWithinMs,
    headCheckQueue: input.headCheckQueue,
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
    scheduledApplyConfirmation: input.expiryApplyConfirmation,
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
    googleConnectionStatus: input.googleConnectionStatus,
    googleReplyObservationStore: createGoogleReplyObservationStore(input.db),
    readBeforePublish: input.readReviewBeforePublish,
    replyCommandStore: input.replyCommandStore,
    dispatchEvidence: input.dispatchEvidence,
    clock: input.clock,
    logger: input.logger,
    idGen: () => replyId(input.idGen()),
    staffPublicApi: input.staffPublicApi,
  })
  input.registry.register(PUBLISH_REPLY_JOB_NAME, async (job) => {
    await publishReplyHandler(
      job as Job<import('../publication/reply-queue.port.server').PublishReplyJobData>,
    )
  })
  input.logger.info(
    { job: PUBLISH_REPLY_JOB_NAME },
    'registered publish-reply job handler',
  )

  const reconcileAmbiguousHandler = createReconcileAmbiguousPublicationsHandler({
    replyRepo: input.replyRepo,
    reviewRepo: input.reviewRepo,
    replyCommandStore: input.replyCommandStore,
    reconcileReplyPublication: input.reconcileReplyPublication,
    dispatchEvidence: input.dispatchEvidence,
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
