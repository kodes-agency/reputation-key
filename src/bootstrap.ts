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
import { createHealthChecker } from '#/shared/observability/health-metrics'
import { createJobQueue, type Queue } from '#/shared/jobs/queue'
import { QUARANTINE_QUEUE_NAME } from '#/shared/jobs/failure-quarantine'
import { readAllQueueDepths } from '#/shared/health/queue-depth'
import { isCapabilityJobEnabled, type Capability } from '#/shared/auth/beta-capabilities'
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
  createRefreshRollupHandler,
  JOB_NAMES,
} from '#/contexts/metric/infrastructure/jobs/refresh-materialized-view.job'
import {
  createPublishReplyHandler,
  JOB_NAME as PUBLISH_REPLY_JOB_NAME,
} from '#/contexts/review/infrastructure/jobs/publish-reply.job'
import { createAtomicReplyCommandStore } from '#/contexts/review/infrastructure/reply-command-store'
import { activityLogId, replyId } from '#/shared/domain/ids'

// BQC-3.7: lazily-created ops queue handles for the health-check's metric
// sample. The domain-events and quarantine queues are owned by the worker
// entry point, which starts AFTER bootstrap — so the health-check opens its
// own read-only handles on first use and reuses them (one Redis connection
// per queue per process, never two).
let opsQueues:
  | { domainEvents: Queue | undefined; quarantine: Queue | undefined }
  | undefined

function getOpsQueues(): {
  domainEvents: Queue | undefined
  quarantine: Queue | undefined
} {
  if (!opsQueues) {
    opsQueues = {
      domainEvents: createJobQueue('domain-events'),
      quarantine: createJobQueue(QUARANTINE_QUEUE_NAME),
    }
  }
  return opsQueues
}

export async function bootstrap(container: Container): Promise<void> {
  const logger = getLogger()

  /**
   * BQR-0: Register a job only when its capability is globally enabled.
   * When dark/blocked, register a no-op so leftover Redis repeatable jobs
   * drain harmlessly instead of executing dark work.
   */
  function registerCapabilityGatedJob(
    jobName: string,
    capability: Capability,
    handler: (job: import('bullmq').Job) => Promise<void>,
  ): void {
    if (!isCapabilityJobEnabled(capability)) {
      container.jobRegistry.register(jobName, async () => {
        logger.info(
          { job: jobName, capability },
          'BQR-0: skipping dark/blocked capability job',
        )
      })
      logger.info(
        { job: jobName, capability },
        'registered no-op job handler (capability dark/blocked)',
      )
      return
    }
    container.jobRegistry.register(jobName, handler)
    logger.info({ job: jobName, capability }, 'registered capability-gated job handler')
  }

  // ── Register background job handlers ─────────────────────────────
  const healthCheckHandler = createHealthCheckHandler({
    dbHealthy: isDbHealthy,
    redisHealthy: isRedisHealthy,
    logger,
    clock: container.clock,
    // BQR-6.2: stamp worker liveness for /api/health/metrics
    recordHeartbeat: async () => {
      const { getRedis } = await import('#/shared/cache/redis')
      const { writeWorkerHeartbeat } = await import('#/shared/health/worker-heartbeat')
      await writeWorkerHeartbeat(getRedis() ?? undefined, container.clock)
    },
    // BQC-3.7: outbox/quarantine metric sample for the threshold evaluation.
    sampleOpsMetrics: async () => {
      const snapshot = await createHealthChecker(container.db, container.outboxRepo, {
        quarantineQueue: getOpsQueues().quarantine ?? null,
      }).check()
      return {
        oldestUnpublishedAgeMs: snapshot.outbox.oldestUnpublishedAgeMs,
        stalledLeaseCount: snapshot.outbox.stalledLeaseCount,
        quarantineCount: snapshot.quarantine?.count ?? 0,
        oldestQuarantinedAgeMs: snapshot.quarantine?.oldestAgeMs ?? null,
      }
    },
    // BQC-3.7: queue-depth read incl. domain-events + quarantine.
    readQueueDepths: () =>
      readAllQueueDepths([
        { name: 'default', queue: container.jobQueue ?? null },
        { name: 'background', queue: container.backgroundQueue ?? null },
        { name: 'domain-events', queue: getOpsQueues().domainEvents ?? null },
        { name: QUARANTINE_QUEUE_NAME, queue: getOpsQueues().quarantine ?? null },
      ]),
  })

  // Handler returns HealthCheckResult (BullMQ stores it as return value);
  // wrap to satisfy the JobHandler<unknown> signature which expects void.
  container.jobRegistry.register(JOB_NAME, async (job) => {
    void (await healthCheckHandler(job))
  })
  logger.info({ job: JOB_NAME }, 'registered health-check job handler')

  // ── Portal image processing job (portal dark / portal.upload blocked) ──
  const processImageHandler = createProcessImageJob({
    storage: container.storage,
    portalRepo: container.portalRepo,
    clock: container.clock,
  })
  registerCapabilityGatedJob(PROCESS_IMAGE_JOB_NAME, 'portal.upload', async (job) => {
    await processImageHandler(
      job as import('bullmq').Job<
        import('#/contexts/portal/infrastructure/jobs/process-image.job').ProcessImageJobData
      >,
    )
  })

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
  const syncReviewsHandler = createSyncPropertyReviewsHandler({
    // BQR-2.3: use composition-wired use case (atomic ReviewCommandStore)
    syncReviews: container.useCases.syncReviews,
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
  const { createReviewRefreshRunRepository } =
    await import('#/contexts/review/infrastructure/repositories/review-refresh-run.repository')
  const refreshHandler = createRefreshExpiringReviewsHandler({
    reviewRepo: container.reviewRepo,
    queue: container.reviewQueue,
    refreshRunRepo: createReviewRefreshRunRepository(container.db),
    clock: container.clock,
  })
  container.jobRegistry.register(REFRESH_EXPIRING_JOB_NAME, async (job) => {
    await refreshHandler(job)
  })
  logger.info(
    { job: REFRESH_EXPIRING_JOB_NAME },
    'registered refresh-expiring-reviews job handler',
  )

  // BQC-3.3: atomic reply/review state + outbox writes for the purge and
  // publish job handlers (one instance, shared — the store is stateless).
  const replyCommandStore = createAtomicReplyCommandStore(
    container.db,
    container.eventBus,
  )

  const purgeHandler = createPurgeExpiredReviewsHandler({
    reviewRepo: container.reviewRepo,
    commandStore: replyCommandStore,
    clock: container.clock,
    db: container.db,
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
    replyCommandStore,
    clock: container.clock,
    idGen: () => replyId(crypto.randomUUID()),
    staffPublicApi: container.staffPublicApi,
  })
  container.jobRegistry.register(PUBLISH_REPLY_JOB_NAME, async (job) => {
    await publishReplyHandler(
      job as import('bullmq').Job<
        import('#/contexts/review/application/ports/reply-queue.port').PublishReplyJobData
      >,
    )
  })
  logger.info({ job: PUBLISH_REPLY_JOB_NAME }, 'registered publish-reply job handler')

  // ── Reconcile ambiguous reply publications (BQC-3.8) ──────────────
  // Sweep over replies whose Google send outcome was ambiguous on the final
  // attempt (publication_state='ambiguous', reconcile_due_at <= now); each
  // due row re-reads provider state via the composition-wired reconcile use
  // case (provider read only — never a send).
  const {
    createReconcileAmbiguousPublicationsHandler,
    JOB_NAME: RECONCILE_AMBIGUOUS_JOB_NAME,
  } =
    await import('#/contexts/review/infrastructure/jobs/reconcile-ambiguous-publications.job')
  const reconcileAmbiguousHandler = createReconcileAmbiguousPublicationsHandler({
    replyRepo: container.replyRepo,
    reconcileReplyPublication: container.useCases.reconcileReplyPublication,
    clock: container.clock,
  })
  container.jobRegistry.register(RECONCILE_AMBIGUOUS_JOB_NAME, async (job) => {
    await reconcileAmbiguousHandler(job)
  })
  logger.info(
    { job: RECONCILE_AMBIGUOUS_JOB_NAME },
    'registered reconcile-ambiguous-publications job handler',
  )

  // ── Register event handlers here as contexts are added ────────────
  // Example:
  //   container.eventBus.on('portal.created', (event) => { ... })

  // ── Metric incremental rollup refresh jobs ─────────────────────────
  const metricRollupDeps = { db: container.db }
  for (const [queryKey, jobName] of [
    ['dailyMetrics', JOB_NAMES.refreshDailyMetrics],
    ['weeklyMetrics', JOB_NAMES.refreshWeeklyMetrics],
    ['dailyInboxMetrics', JOB_NAMES.refreshDailyInboxMetrics],
  ] as const) {
    const handler = createRefreshRollupHandler(metricRollupDeps, queryKey)
    container.jobRegistry.register(jobName, handler)
    logger.info({ job: jobName }, 'registered metric rollup refresh job handler')
  }

  // ── Retention sweep (BQC-1.6: bounded, evidence-backed, daily) ──────
  const { createRetentionSweepHandler, JOB_NAME: RETENTION_SWEEP_JOB_NAME } =
    await import('#/shared/jobs/retention-sweep.job')
  const retentionSweepHandler = createRetentionSweepHandler({
    db: container.db,
    clock: container.clock,
  })
  container.jobRegistry.register(RETENTION_SWEEP_JOB_NAME, async (job) => {
    await retentionSweepHandler(job)
  })
  logger.info({ job: RETENTION_SWEEP_JOB_NAME }, 'registered retention sweep job handler')

  // ── Goal event handlers ────────────────────────────────────────────
  // NOTE: Goal event handlers are now registered inside buildGoalContext
  // (composition.ts) so they're available in both web server and worker.
  // No separate registration needed here.

  // ── Goal reconciliation job (goal.use dark) ────────────────────────
  const { createReconcileGoalProgressHandler, RECONCILE_GOAL_JOB_NAME } =
    await import('#/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job')
  const reconcileHandler = createReconcileGoalProgressHandler({
    goalRepo: container.goalRepo,
    metricApi: container.metricPublicApi,
    events: container.eventBus,
    clock: container.clock,
  })
  registerCapabilityGatedJob(RECONCILE_GOAL_JOB_NAME, 'goal.use', async (job) => {
    await reconcileHandler(job)
  })

  // ── Goal recurring instance spawner job (goal.use dark) ────────────
  const { createSpawnRecurringInstancesHandler, SPAWN_RECURRING_JOB_NAME } =
    await import('#/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job')
  const spawnHandler = createSpawnRecurringInstancesHandler({
    goalRepo: container.goalRepo,
    events: container.eventBus,
    clock: container.clock,
    idGen: () => crypto.randomUUID(),
  })
  registerCapabilityGatedJob(SPAWN_RECURRING_JOB_NAME, 'goal.use', async (job) => {
    await spawnHandler(job)
  })

  // ── Activity log insertion job ────────────────────────────────────
  const { createInsertActivityLogHandler, INSERT_ACTIVITY_LOG_JOB_NAME } =
    await import('#/contexts/activity/infrastructure/jobs/insert-activity-log.job')
  const { createDbUserLookupAdapter } =
    await import('#/contexts/activity/infrastructure/adapters/db-user-lookup.adapter')
  const dbUserLookup = createDbUserLookupAdapter(container.db)
  const insertActivityLogHandler = createInsertActivityLogHandler({
    repo: container.activityRepo,
    userLookup: dbUserLookup,
    clock: container.clock,
    logger: container.logger,
    idGen: () => activityLogId(crypto.randomUUID()),
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

  // ── Notification jobs ────────────────────────────────────────────
  const { createInsertNotificationHandler, INSERT_NOTIFICATION_JOB_NAME } =
    await import('#/contexts/notification/infrastructure/jobs/insert-notification.job')
  const { createDbUserLookupAdapter: createNotifUserLookup } =
    await import('#/contexts/notification/infrastructure/adapters/db-user-lookup.adapter')
  const { createResendEmailAdapter } =
    await import('#/contexts/notification/infrastructure/adapters/resend-email.adapter')
  const { notificationId, notificationEmailId } = await import('#/shared/domain/ids')
  const notifUserLookup = createNotifUserLookup(container.db)
  const notifEmailSender = createResendEmailAdapter()
  const insertNotifHandler = createInsertNotificationHandler({
    notificationRepo: container.notificationRepo,
    emailRepo: container.notificationEmailRepo,
    preferenceRepo: container.notificationPrefRepo,
    clock: container.clock,
    idGen: () => notificationId(crypto.randomUUID()),
    emailIdGen: () => notificationEmailId(crypto.randomUUID()),
    logger: container.logger,
  })
  container.jobRegistry.register(INSERT_NOTIFICATION_JOB_NAME, async (job) => {
    await insertNotifHandler(
      job as import('bullmq').Job<
        import('#/contexts/notification/infrastructure/jobs/insert-notification.job').InsertNotificationJobData
      >,
    )
  })
  logger.info(
    { job: INSERT_NOTIFICATION_JOB_NAME },
    'registered insert-notification job handler',
  )

  // Outbound email is blocked (notification.send_email) for beta.
  const { createUrgentEmailJobHandler, URGENT_EMAIL_JOB_NAME } =
    await import('#/contexts/notification/infrastructure/jobs/urgent-email.job')
  const urgentEmailHandler = createUrgentEmailJobHandler({
    emailRepo: container.notificationEmailRepo,
    notifRepo: container.notificationRepo,
    userLookup: notifUserLookup,
    emailSender: notifEmailSender,
    logger: container.logger,
    clock: container.clock,
  })
  registerCapabilityGatedJob(
    URGENT_EMAIL_JOB_NAME,
    'notification.send_email',
    async (job) => {
      await urgentEmailHandler(
        job as import('bullmq').Job<
          import('#/contexts/notification/infrastructure/jobs/urgent-email.job').UrgentEmailJobData
        >,
      )
    },
  )

  const { createDigestNotificationJobHandler, DIGEST_JOB_NAME } =
    await import('#/contexts/notification/infrastructure/jobs/digest-notification.job')
  const { getPool } = await import('#/shared/db/pool')
  const digestHandler = createDigestNotificationJobHandler({
    pool: getPool(),
    emailRepo: container.notificationEmailRepo,
    notifRepo: container.notificationRepo,
    userLookup: notifUserLookup,
    emailSender: notifEmailSender,
    logger: container.logger,
    clock: container.clock,
  })
  registerCapabilityGatedJob(DIGEST_JOB_NAME, 'notification.send_email', async (job) => {
    await digestHandler(job as import('bullmq').Job<void>)
  })

  // ── Seed system badge definitions ────────────────────────────────
  // Seeding is idempotent domain data used by the recognition model; it does
  // not evaluate awards. Safe to run while badge.use is dark.
  try {
    await container.useCases.seedBadgeDefinitions()
    logger.info('seeded system badge definitions')
  } catch (e) {
    logger.error({ err: e }, 'failed to seed badge definitions')
  }

  // ── Badge reconciliation job (badge.use dark) ─────────────────────
  registerCapabilityGatedJob('badge.reconcile', 'badge.use', async () => {
    await container.useCases.reconcileBadgeDefinitions({})
  })

  // ── Leaderboard reconciliation job (leaderboard.use dark) ─────────
  registerCapabilityGatedJob('leaderboard.reconcile', 'leaderboard.use', async () => {
    await container.useCases.reconcileLeaderboards()
  })
}
