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
import { createProcessImageJob } from '#/contexts/portal/infrastructure/jobs/process-image.job'
import { createImportPropertyHandler } from '#/contexts/integration/infrastructure/jobs/import-property.job'
import { createSyncPropertyReviewsHandler } from '#/contexts/review/infrastructure/jobs/sync-property-reviews.job'
import { createRefreshExpiringReviewsHandler } from '#/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job'
import { createPurgeExpiredReviewsHandler } from '#/contexts/review/infrastructure/jobs/purge-expired-reviews.job'
import {
  createRefreshMatViewHandler,
  JOB_NAMES,
} from '#/contexts/metric/infrastructure/jobs/refresh-materialized-view.job'
import { createPublishReplyHandler } from '#/contexts/review/infrastructure/jobs/publish-reply.job'
import { replyId } from '#/shared/domain/ids'

export function bootstrap(container: Container): void {
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
  })
  container.jobRegistry.register('process-image', async (job) => {
    await processImageHandler(
      job as import('bullmq').Job<
        import('#/contexts/portal/infrastructure/jobs/process-image.job').ProcessImageJobData
      >,
    )
  })
  logger.info({ job: 'process-image' }, 'registered process-image job handler')

  // ── GBP property import job ─────────────────────────────────────
  const importHandler = createImportPropertyHandler({
    events: container.eventBus,
  })
  container.jobRegistry.register('import-property', async (job) => {
    await importHandler(
      job as import('bullmq').Job<
        import('#/contexts/integration/infrastructure/jobs/import-property.job').ImportPropertyJobData
      >,
    )
  })
  logger.info({ job: 'import-property' }, 'registered import-property job handler')

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
  container.jobRegistry.register('sync-property-reviews', async (job) => {
    await syncReviewsHandler(
      job as import('bullmq').Job<
        import('#/contexts/review/application/ports/review-queue.port').SyncPropertyReviewsJobData
      >,
    )
  })
  logger.info(
    { job: 'sync-property-reviews' },
    'registered sync-property-reviews job handler',
  )

  // ── Review retention jobs ────────────────────────────────────────
  const refreshHandler = createRefreshExpiringReviewsHandler({
    reviewRepo: container.reviewRepo,
    queue: container.reviewQueue,
    clock: () => new Date(),
  })
  container.jobRegistry.register('refresh-expiring-reviews', async (job) => {
    await refreshHandler(job)
  })
  logger.info(
    { job: 'refresh-expiring-reviews' },
    'registered refresh-expiring-reviews job handler',
  )

  const purgeHandler = createPurgeExpiredReviewsHandler({
    reviewRepo: container.reviewRepo,
    events: container.eventBus,
    clock: () => new Date(),
  })
  container.jobRegistry.register('purge-expired-reviews', async (job) => {
    await purgeHandler(job)
  })
  logger.info(
    { job: 'purge-expired-reviews' },
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
  container.jobRegistry.register('publish-reply', async (job) => {
    await publishReplyHandler(
      job as import('bullmq').Job<
        import('#/contexts/review/application/ports/reply-queue.port').PublishReplyJobData
      >,
    )
  })
  logger.info({ job: 'publish-reply' }, 'registered publish-reply job handler')

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
}
