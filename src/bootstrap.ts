// Bootstrap — registers event handlers and background jobs at startup.
// This is separate from composition.ts so that construction and registration
// are easy to understand independently.
//
// Per architecture: "Keeping registration separate from construction
// makes both easier to understand."

import type { Container } from './composition'
import { createHealthCheckHandler, JOB_NAME } from '#/shared/jobs/health-check.job'
import { isDbHealthy } from '#/shared/db'
import { isRedisHealthy } from '#/shared/cache/redis'
import { getLogger } from '#/shared/observability/logger'
import {
  createProcessImageJob,
  JOB_NAME as PROCESS_IMAGE_JOB_NAME,
} from '#/contexts/portal/infrastructure/jobs/process-image.job'
import {
  createImportPropertyHandler,
  JOB_NAME as IMPORT_PROPERTY_JOB_NAME,
} from '#/contexts/integration/infrastructure/jobs/import-property.job'
import {
  createSyncPropertyReviewsHandler,
  JOB_NAME as SYNC_REVIEWS_JOB_NAME,
} from '#/contexts/review/infrastructure/jobs/sync-property-reviews.job'
import {
  createRefreshExpiringReviewsHandler,
  JOB_NAME as REFRESH_EXPIRING_JOB_NAME,
} from '#/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job'
import {
  createPurgeExpiredReviewsHandler,
  JOB_NAME as PURGE_EXPIRED_JOB_NAME,
} from '#/contexts/review/infrastructure/jobs/purge-expired-reviews.job'
import {
  createRefreshMatViewHandler,
  JOB_NAMES,
} from '#/contexts/metric/infrastructure/jobs/refresh-materialized-view.job'
import {
  createPublishReplyHandler,
  JOB_NAME as PUBLISH_REPLY_JOB_NAME,
} from '#/contexts/review/infrastructure/jobs/publish-reply.job'
import { replyId } from '#/shared/domain/ids'

export async function bootstrap(container: Container): Promise<void> {
  const logger = getLogger()

  // ── Register background job handlers ─────────────────────────────
  const healthCheckHandler = createHealthCheckHandler({
    dbHealthy: isDbHealthy,
    redisHealthy: isRedisHealthy,
    logger,
    clock: () => new Date(),
  })

  // Handler returns HealthCheckResult (BullMQ stores it as return value);
  // wrap to satisfy the JobHandler<unknown> signature which expects void.
  container.jobRegistry.register(JOB_NAME, async (job) => {
    void (await healthCheckHandler(job))
  })
  logger.info({ job: JOB_NAME }, 'registered health-check job handler')

  // ── Portal image processing job ──────────────────────────────────
  const processImageHandler = createProcessImageJob({
    storage: container.storage,
    portalRepo: container.portalRepo,
    clock: () => new Date(),
  })
  container.jobRegistry.register(PROCESS_IMAGE_JOB_NAME, async (job) => {
    await processImageHandler(
      job as import('bullmq').Job<
        import('#/contexts/portal/infrastructure/jobs/process-image.job').ProcessImageJobData
      >,
    )
  })
  logger.info({ job: PROCESS_IMAGE_JOB_NAME }, 'registered process-image job handler')

  // ── GBP property import job ─────────────────────────────────────
  const importHandler = createImportPropertyHandler({
    importPropertyUseCase: container.useCases.importProperty,
  })
  container.jobRegistry.register(IMPORT_PROPERTY_JOB_NAME, async (job) => {
    await importHandler(
      job as import('bullmq').Job<
        import('#/contexts/integration/infrastructure/jobs/import-property.job').ImportPropertyJobData
      >,
    )
  })
  logger.info({ job: IMPORT_PROPERTY_JOB_NAME }, 'registered import-property job handler')

  // ── Review sync jobs ─────────────────────────────────────────────
  // Reuse the single GoogleReviewApiAdapter from the composition root (S15 fix).
  const googleReviewApiForJobs = container.googleReviewApi

  const syncReviewsHandler = createSyncPropertyReviewsHandler({
    reviewRepo: container.reviewRepo,
    replyRepo: container.replyRepo,
    googleReviewApi: googleReviewApiForJobs,
    events: container.eventBus,
    clock: () => new Date(),
  })
  container.jobRegistry.register(SYNC_REVIEWS_JOB_NAME, async (job) => {
    await syncReviewsHandler(
      job as import('bullmq').Job<
        import('#/contexts/review/application/ports/review-queue.port').SyncPropertyReviewsJobData
      >,
    )
  })
  logger.info(
    { job: SYNC_REVIEWS_JOB_NAME },
    'registered sync-property-reviews job handler',
  )

  // ── Review retention jobs ────────────────────────────────────────
  const refreshHandler = createRefreshExpiringReviewsHandler({
    reviewRepo: container.reviewRepo,
    queue: container.reviewQueue,
    clock: () => new Date(),
  })
  container.jobRegistry.register(REFRESH_EXPIRING_JOB_NAME, async (job) => {
    await refreshHandler(job)
  })
  logger.info(
    { job: REFRESH_EXPIRING_JOB_NAME },
    'registered refresh-expiring-reviews job handler',
  )

  const purgeHandler = createPurgeExpiredReviewsHandler({
    reviewRepo: container.reviewRepo,
    events: container.eventBus,
    clock: () => new Date(),
  })
  container.jobRegistry.register(PURGE_EXPIRED_JOB_NAME, async (job) => {
    await purgeHandler(job)
  })
  logger.info(
    { job: PURGE_EXPIRED_JOB_NAME },
    'registered purge-expired-reviews job handler',
  )

  // ── Reply publish job ──────────────────────────────────────────────
  const publishReplyHandler = createPublishReplyHandler({
    replyRepo: container.replyRepo,
    reviewRepo: container.reviewRepo,
    googleReviewApi: container.googleReviewApi,
    events: container.eventBus,
    clock: () => new Date(),
    idGen: () => replyId(crypto.randomUUID()),
  })
  container.jobRegistry.register(PUBLISH_REPLY_JOB_NAME, async (job) => {
    await publishReplyHandler(
      job as import('bullmq').Job<
        import('#/contexts/review/application/ports/reply-queue.port').PublishReplyJobData
      >,
    )
  })
  logger.info({ job: PUBLISH_REPLY_JOB_NAME }, 'registered publish-reply job handler')

  // ── Register event handlers here as contexts are added ────────────
  // Example:
  //   container.eventBus.on('portal.created', (event) => { ... })

  // ── Metric materialized view refresh jobs ──────────────────────────
  const metricMatViewDeps = { db: container.db }
  for (const [queryKey, jobName] of [
    ['dailyMetrics', JOB_NAMES.refreshDailyMetrics],
    ['weeklyMetrics', JOB_NAMES.refreshWeeklyMetrics],
    ['dailyInboxMetrics', JOB_NAMES.refreshDailyInboxMetrics],
  ] as const) {
    const handler = createRefreshMatViewHandler(metricMatViewDeps, queryKey)
    container.jobRegistry.register(jobName, handler)
    logger.info({ job: jobName }, 'registered metric refresh job handler')
  }

  // ── Goal event handlers ────────────────────────────────────────────
  // NOTE: Goal event handlers are now registered inside buildGoalContext
  // (composition.ts) so they're available in both web server and worker.
  // No separate registration needed here.

  // ── Goal reconciliation job ────────────────────────────────────────
  const { createReconcileGoalProgressHandler, RECONCILE_GOAL_JOB_NAME } =
    await import('#/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job')
  const reconcileHandler = createReconcileGoalProgressHandler({
    goalRepo: container.goalRepo,
    metricApi: container.metricPublicApi,
    events: container.eventBus,
    clock: () => new Date(),
  })
  container.jobRegistry.register(RECONCILE_GOAL_JOB_NAME, async (job): Promise<void> => {
    await reconcileHandler(job)
  })
  logger.info(
    { job: RECONCILE_GOAL_JOB_NAME },
    'registered goal reconciliation job handler',
  )

  // ── Goal recurring instance spawner job ────────────────────────────
  const { createSpawnRecurringInstancesHandler, SPAWN_RECURRING_JOB_NAME } =
    await import('#/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job')
  const spawnHandler = createSpawnRecurringInstancesHandler({
    goalRepo: container.goalRepo,
    events: container.eventBus,
    clock: () => new Date(),
    idGen: () => crypto.randomUUID(),
  })
  container.jobRegistry.register(SPAWN_RECURRING_JOB_NAME, async (job): Promise<void> => {
    await spawnHandler(job)
  })
  logger.info(
    { job: SPAWN_RECURRING_JOB_NAME },
    'registered goal recurring spawner job handler',
  )

  // ── Activity log insertion job ────────────────────────────────────
  const { createInsertActivityLogHandler, INSERT_ACTIVITY_LOG_JOB_NAME } =
    await import('#/contexts/activity/infrastructure/jobs/insert-activity-log.job')
  const { createDbUserLookupAdapter } =
    await import('#/contexts/activity/infrastructure/adapters/db-user-lookup.adapter')
  const dbUserLookup = createDbUserLookupAdapter(container.db)
  const insertActivityLogHandler = createInsertActivityLogHandler({
    repo: container.activityRepo,
    userLookup: dbUserLookup,
    clock: () => new Date(),
    logger: container.logger,
    idGen: () => crypto.randomUUID(),
  })
  container.jobRegistry.register(
    INSERT_ACTIVITY_LOG_JOB_NAME,
    async (job): Promise<void> => {
      await insertActivityLogHandler(
        job as import('bullmq').Job<
          import('#/contexts/activity/infrastructure/jobs/insert-activity-log.job').InsertActivityLogJobData
        >,
      )
    },
  )
  logger.info(
    { job: INSERT_ACTIVITY_LOG_JOB_NAME },
    'registered activity log insertion job handler',
  )
}
