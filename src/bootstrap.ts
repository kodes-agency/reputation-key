// Bootstrap — registers event handlers and background jobs at startup.
// This is separate from composition.ts so that construction and registration
// are easy to understand independently.
//
// Per architecture: "Keeping registration separate from construction
// makes both easier to understand."

import type { Container } from './composition'
import { createHealthCheckHandler, JOB_NAME } from '#/shared/jobs/health-check.job'
import { isDbHealthy } from '#/shared/health/db-probe'
import { isRedisHealthy } from '#/shared/cache/redis'
import { getLogger } from '#/shared/observability/logger'
import { createAlertAuxReader } from '#/shared/observability/alert-aux-reads'
import { createRedisAlertStateStore } from '#/shared/health/alert-state'
import { QUARANTINE_QUEUE_NAME } from '#/shared/jobs/failure-quarantine'
import { readAllQueueDepths } from '#/shared/health/queue-depth'
import { isCapabilityJobEnabled, type Capability } from '#/shared/auth/beta-capabilities'
import {
  createProcessImageJob,
  JOB_NAME as PROCESS_IMAGE_JOB_NAME,
} from '#/contexts/portal/infrastructure/jobs/process-image.job'
import { createGoogleImportV2ItemJobHandler } from '#/contexts/integration/infrastructure/jobs/import-gbp-property-item-v2.job'
import { GOOGLE_PROPERTY_IMPORT_ITEM_JOB } from '#/contexts/integration/application/google-import-v2-contract'
import {
  createGoogleImportClaimReaperHandler,
  JOB_NAME as GOOGLE_IMPORT_CLAIM_REAPER_JOB,
} from '#/contexts/integration/infrastructure/jobs/google-import-claim-reaper.job'
import { createGoogleImportV2ClaimReaper } from '#/contexts/integration/application/google-import-v2-claim-reaper'
import { createGoogleImportV2Store } from '#/contexts/integration/infrastructure/google-import-v2-store'
import {
  createAiOperationExecutionReaperHandler,
  JOB_NAME as AI_EXECUTION_REAPER_JOB_NAME,
} from '#/shared/jobs/ai-operation-execution-reaper.job'
import { createAiOperationExecutionReaper } from '#/contexts/ai/application/ai-operation-execution-reaper'
import { createAiOperationStoreAdapter } from '#/contexts/ai/infrastructure/adapters/ai-operation-store.adapter'
import {
  createSyncPropertyReviewsHandler,
  JOB_NAME as SYNC_REVIEWS_JOB_NAME,
} from '#/contexts/review/infrastructure/jobs/sync-property-reviews.job'
import {
  createRefreshExpiringReviewsHandler,
  JOB_NAME as REFRESH_EXPIRING_JOB_NAME,
} from '#/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job'
import {
  createDiscoverNewReviewsHandler,
  JOB_NAME as DISCOVER_NEW_REVIEWS_JOB_NAME,
} from '#/contexts/review/infrastructure/jobs/discover-new-reviews.job'
import { createReviewDiscoveryRepository } from '#/contexts/review/infrastructure/repositories/review-discovery.repository'
import { getEnv } from '#/shared/config/env'
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
import { createScheduledScopeAuthorizer } from '#/shared/jobs/delayed-execution-gate'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import {
  createExpireReviewProviderSourceHandler,
  createSweepReviewProviderTombstonesHandler,
  EXPIRE_REVIEW_PROVIDER_SOURCE_JOB_NAME,
  SWEEP_REVIEW_PROVIDER_TOMBSTONES_JOB_NAME,
  type ReviewProviderLifecycleSweepJobData,
} from '#/contexts/review/infrastructure/jobs/review-provider-lifecycle-sweeps.job'
import { createReviewProviderSnapshotRepository } from '#/contexts/review/infrastructure/repositories/review-provider-snapshot.repository'
import {
  createGeneratePropertyTrendJobHandler,
  GENERATE_PROPERTY_TREND_JOB_NAME,
} from '#/contexts/ai/infrastructure/jobs/generate-property-trend.job'
import {
  createSchedulePropertyTrendsJobHandler,
  SCHEDULE_PROPERTY_TRENDS_JOB_NAME,
} from '#/contexts/ai/infrastructure/jobs/schedule-property-trends.job'

// BQC-5.5: the ops queue read handles are composition-owned (container.opsQueues)
// — the per-module getOpsQueues() duplicate is gone. The health-check job
// consumes the same read-only handles as /api/health/metrics.

export async function bootstrap(
  container: Container,
  options: Readonly<{ allowUnavailableGoogleImportV2Processor?: boolean }> = {},
): Promise<void> {
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
  // BQC-7.4: the alert evaluation wiring — the container-owned snapshot
  // reader and dispatcher, the aux reads (retention/policy denials/region
  // attempts), and the Redis firing-state store (edge-trigger hysteresis).
  const alertAuxReader = createAlertAuxReader({
    db: container.db,
    quarantineQueue: container.opsQueues.quarantine ?? null,
    logger,
  })
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
    // BQC-7.4: alert evaluation inputs + dispatch (supersedes the 3.7
    // warn-only threshold sample).
    readOperationsSnapshot: () => container.operationsSnapshot.read(),
    readAlertAux: () => alertAuxReader.read(),
    alertState: container.redis ? createRedisAlertStateStore(container.redis) : undefined,
    alertDispatcher: container.alertDispatcher,
    // BQC-3.7: queue-depth read incl. domain-events + quarantine.
    readQueueDepths: () =>
      readAllQueueDepths([
        { name: 'default', queue: container.jobQueue ?? null },
        { name: 'background', queue: container.backgroundQueue ?? null },
        { name: 'domain-events', queue: container.opsQueues.domainEvents ?? null },
        { name: QUARANTINE_QUEUE_NAME, queue: container.opsQueues.quarantine ?? null },
      ]),
  })

  // Preserve the result: BullMQ writes it to the job record for diagnostics.
  container.jobRegistry.register(JOB_NAME, async (job) => healthCheckHandler(job))
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

  const processGoogleImportV2Item = container.useCases.processGoogleImportV2Item
  if (processGoogleImportV2Item) {
    const importV2Handler = createGoogleImportV2ItemJobHandler(processGoogleImportV2Item)
    registerCapabilityGatedJob(
      GOOGLE_PROPERTY_IMPORT_ITEM_JOB,
      'property.import_gbp_v2',
      async (job) => {
        await importV2Handler(
          job as import('bullmq').Job<
            import('#/contexts/integration/application/ports/gbp-queue.port').GoogleImportV2ItemJobData
          >,
        )
      },
    )
  } else if (
    isCapabilityJobEnabled('property.import_gbp_v2') &&
    !options.allowUnavailableGoogleImportV2Processor
  ) {
    throw new Error('Google import v2 processor dependencies are unavailable')
  }

  // Claim-lease reaper for the job above. Registered under the same
  // capability so its posture cannot drift from the work it recovers, and
  // built from the container db directly: it only needs the import store's
  // CAS helpers, no processor dependencies, so it stays available even when
  // the item processor could not be constructed.
  registerCapabilityGatedJob(
    GOOGLE_IMPORT_CLAIM_REAPER_JOB,
    'property.import_gbp_v2',
    createGoogleImportClaimReaperHandler({
      reap: createGoogleImportV2ClaimReaper({
        store: createGoogleImportV2Store(container.db),
        clock: container.clock,
      }),
    }),
  )

  // ── Review provider-snapshot jobs ────────────────────────────────
  const syncReviewsHandler = createSyncPropertyReviewsHandler({
    runSnapshot: container.useCases.runReviewProviderSnapshot,
    propertyRouting: container.propertyProcessingScopeApi,
    enqueueContinuation: async (data) => {
      await container.reviewQueue.addSyncJob(data)
    },
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
  const reviewProviderSnapshotRepository = createReviewProviderSnapshotRepository(
    container.db,
    container.eventBus,
  )
  const enqueueReviewProviderLifecycleContinuation = async (
    jobName:
      | typeof EXPIRE_REVIEW_PROVIDER_SOURCE_JOB_NAME
      | typeof SWEEP_REVIEW_PROVIDER_TOMBSTONES_JOB_NAME,
    data: ReviewProviderLifecycleSweepJobData,
  ): Promise<void> => {
    if (!container.backgroundQueue) {
      throw new Error('Review provider lifecycle queue is unavailable')
    }
    await container.backgroundQueue.add(jobName, data, {
      jobId: `${jobName}-${data.beforeOrAtEpochMillis}-${data.afterReviewId ?? 'start'}`,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      ...jobEnqueueOptions(jobName),
    })
  }
  const expireReviewProviderSourceHandler = createExpireReviewProviderSourceHandler({
    repository: reviewProviderSnapshotRepository,
    enqueueExpiryContinuation: (data) =>
      enqueueReviewProviderLifecycleContinuation(
        EXPIRE_REVIEW_PROVIDER_SOURCE_JOB_NAME,
        data,
      ),
    enqueueTombstoneContinuation: (data) =>
      enqueueReviewProviderLifecycleContinuation(
        SWEEP_REVIEW_PROVIDER_TOMBSTONES_JOB_NAME,
        data,
      ),
  })
  const sweepReviewProviderTombstonesHandler = createSweepReviewProviderTombstonesHandler(
    {
      repository: reviewProviderSnapshotRepository,
      enqueueExpiryContinuation: (data) =>
        enqueueReviewProviderLifecycleContinuation(
          EXPIRE_REVIEW_PROVIDER_SOURCE_JOB_NAME,
          data,
        ),
      enqueueTombstoneContinuation: (data) =>
        enqueueReviewProviderLifecycleContinuation(
          SWEEP_REVIEW_PROVIDER_TOMBSTONES_JOB_NAME,
          data,
        ),
    },
  )
  container.jobRegistry.register(EXPIRE_REVIEW_PROVIDER_SOURCE_JOB_NAME, async (job) => {
    await expireReviewProviderSourceHandler(
      job as import('bullmq').Job<ReviewProviderLifecycleSweepJobData>,
    )
  })
  container.jobRegistry.register(
    SWEEP_REVIEW_PROVIDER_TOMBSTONES_JOB_NAME,
    async (job) => {
      await sweepReviewProviderTombstonesHandler(
        job as import('bullmq').Job<ReviewProviderLifecycleSweepJobData>,
      )
    },
  )
  logger.info(
    {
      jobs: [
        EXPIRE_REVIEW_PROVIDER_SOURCE_JOB_NAME,
        SWEEP_REVIEW_PROVIDER_TOMBSTONES_JOB_NAME,
      ],
    },
    'registered Review provider lifecycle handlers',
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

  // ── New-review discovery sweep ───────────────────────────────────
  // The refresh sweep above only revisits reviews already stored, so it can
  // never find a NEW one. This sweep polls connected properties on their own
  // due schedule and is the only ingestion path when GBP push is unset.
  const discoverHandler = createDiscoverNewReviewsHandler({
    discoveryRepo: createReviewDiscoveryRepository(container.db),
    queue: container.reviewQueue,
    clock: container.clock,
    intervalMs: getEnv().REVIEW_DISCOVERY_INTERVAL_MINUTES * 60 * 1000,
  })
  container.jobRegistry.register(DISCOVER_NEW_REVIEWS_JOB_NAME, async (job) => {
    await discoverHandler(job)
  })
  logger.info(
    { job: DISCOVER_NEW_REVIEWS_JOB_NAME },
    'registered discover-new-reviews job handler',
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
  container.jobRegistry.register(PURGE_EXPIRED_JOB_NAME, async (job) => purgeHandler(job))
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
  const generatePropertyTrendHandler = createGeneratePropertyTrendJobHandler({
    generatePropertyTrend: container.useCases.generatePropertyTrend,
  })
  registerCapabilityGatedJob(
    GENERATE_PROPERTY_TREND_JOB_NAME,
    'ai.detect_trends',
    generatePropertyTrendHandler,
  )
  logger.info(
    { job: GENERATE_PROPERTY_TREND_JOB_NAME },
    'registered property AI trend job handler',
  )
  const schedulePropertyTrendsHandler = createSchedulePropertyTrendsJobHandler({
    schedulePropertyTrends: container.useCases.schedulePropertyTrends,
  })
  registerCapabilityGatedJob(
    SCHEDULE_PROPERTY_TRENDS_JOB_NAME,
    'ai.detect_trends',
    schedulePropertyTrendsHandler,
  )
  logger.info(
    { job: SCHEDULE_PROPERTY_TRENDS_JOB_NAME },
    'registered property AI trend scheduler job handler',
  )

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
    googleImportLifecycleSweep:
      container.useCases.sweepGoogleImportV2Lifecycle ?? undefined,
  })
  container.jobRegistry.register(RETENTION_SWEEP_JOB_NAME, retentionSweepHandler)
  logger.info({ job: RETENTION_SWEEP_JOB_NAME }, 'registered retention sweep job handler')

  // ── Quarantine TTL sweep (BQC-7.8: dead-letter lifecycle bound, daily) ──
  // The quarantine queue is absent when Redis is — the schedule that would
  // dispatch this job is Redis-backed too, so an absent queue is unreachable
  // in practice; the guard keeps registration unconditional like neighbors.
  const { createQuarantineTtlSweepHandler, JOB_NAME: QUARANTINE_TTL_JOB_NAME } =
    await import('#/shared/jobs/quarantine-ttl-sweep.job')
  const quarantineTtlHandler = container.opsQueues.quarantine
    ? createQuarantineTtlSweepHandler({
        queue: container.opsQueues.quarantine,
        clock: container.clock,
        ttlMs: getEnv().QUARANTINE_TTL_DAYS * 24 * 60 * 60 * 1000,
        db: container.db,
      })
    : null
  container.jobRegistry.register(QUARANTINE_TTL_JOB_NAME, async (job) => {
    if (!quarantineTtlHandler) {
      logger.warn(
        { job: QUARANTINE_TTL_JOB_NAME },
        'quarantine queue unavailable — skipping TTL sweep',
      )
      return
    }
    await quarantineTtlHandler(job)
  })
  logger.info(
    { job: QUARANTINE_TTL_JOB_NAME },
    'registered quarantine TTL sweep job handler',
  )

  // ── Execution-permit start-deadline fence (bounded, every 5 minutes) ──
  // `admitted` permits are only fenced lazily by `startExecutionPermit` or by
  // the emergency-kill drain, so an abandoned admission pins its ON DELETE
  // RESTRICT approval binding and inflates the active-permit index forever.
  // Registered unconditionally: an unconfigured/killed Google Content runtime is
  // precisely when nothing will ever start those permits.
  const {
    createPermitStartDeadlineSweepHandler,
    JOB_NAME: PERMIT_START_DEADLINE_SWEEP_JOB_NAME,
  } = await import('#/shared/jobs/permit-start-deadline-sweep.job')
  const { createExecutionPermitStartDeadlineSweeper } =
    await import('#/shared/auth/execution-permit-start-deadline-sweep')
  const { createGoogleContentAuthorityRepository } =
    await import('#/contexts/identity/infrastructure/repositories/google-content-authority.repository')
  container.jobRegistry.register(
    PERMIT_START_DEADLINE_SWEEP_JOB_NAME,
    createPermitStartDeadlineSweepHandler({
      sweep: createExecutionPermitStartDeadlineSweeper({
        store: createGoogleContentAuthorityRepository(container.db),
        clock: container.clock,
      }),
    }),
  )
  logger.info(
    { job: PERMIT_START_DEADLINE_SWEEP_JOB_NAME },
    'registered permit start-deadline sweep job handler',
  )

  // ── AI operation abandoned-execution reaper ───────────────────────
  // `claimExecution` moves an operation to `executing` and only the request
  // path writes a terminal state after it. Anything that kills that path in
  // between leaves the row `executing` forever, and `claim` refuses expired
  // rows so it can never be picked up again either.
  // Registered unconditionally for the same reason as the permit sweep above:
  // a killed or unconfigured AI runtime is precisely when executions get
  // abandoned, so gating the recovery on the capability would disable it
  // exactly when it is needed.
  container.jobRegistry.register(
    AI_EXECUTION_REAPER_JOB_NAME,
    createAiOperationExecutionReaperHandler({
      reap: createAiOperationExecutionReaper({
        store: createAiOperationStoreAdapter(container.db),
        nowEpochMillis: () => container.clock().getTime(),
      }),
    }),
  )
  logger.info(
    { job: AI_EXECUTION_REAPER_JOB_NAME },
    'registered AI operation abandoned-execution reaper job handler',
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
  const { createPropertyGrantHolderLookup } =
    await import('#/contexts/identity/infrastructure/adapters/grant-access-lookup.adapter')
  const notifUserLookup = createNotifUserLookup(
    container.db,
    createPropertyGrantHolderLookup(container.db),
  )
  // Outbound email transport is chosen ONCE, here, and logged loudly. Before
  // this the real Resend adapter was constructed unconditionally, so a local
  // boot with a real key in .env mailed real inboxes, and a boot with the
  // .env.example placeholder failed deep inside a BullMQ job instead of at
  // wiring time. Rules live in shared/email/transport-selection.ts.
  const { decideEmailTransport } = await import('#/shared/email/transport-selection')
  const { createCapturingEmailSender } =
    await import('#/shared/testing/capturing-email-sender')
  const emailTransport = decideEmailTransport(getEnv())
  const notifEmailSender =
    emailTransport.mode === 'capture'
      ? createCapturingEmailSender({ clock: container.clock })
      : createResendEmailAdapter()
  if (emailTransport.mode === 'capture') {
    logger.warn(
      { transport: 'capture', reason: emailTransport.reason },
      'NOTIFICATION EMAIL IS BEING CAPTURED, NOT SENT — no message will reach a recipient',
    )
  } else {
    logger.info(
      { transport: 'send', reason: emailTransport.reason },
      'notification email will be delivered through Resend',
    )
  }
  // Deep links in email are absolute; the base URL is injected, never read
  // from env inside a job.
  const notifBaseUrl = getEnv().BETTER_AUTH_URL
  const { getPool } = await import('#/shared/db/pool')
  const { createNotificationPropertyScopeResolver } =
    await import('#/contexts/notification/infrastructure/repositories/notification-property-scope.repository')
  const { createNotificationOrganizationScopeResolver } =
    await import('#/contexts/notification/infrastructure/repositories/notification-organization-scope.repository')
  const resolveNotificationProperty = createNotificationPropertyScopeResolver(getPool())
  // ADR 0046 r.3: the organization fallback timezone plus property display
  // names for digest grouping.
  const resolveNotificationOrgScope =
    createNotificationOrganizationScopeResolver(getPool())
  const authorizeUrgentNotification = createScheduledScopeAuthorizer(
    'system:notification.email_urgent',
  )
  const { createJobExecutionEnvelope } =
    await import('#/shared/jobs/delayed-execution-gate')
  // The insert handler must be able to dispatch the immediate email itself:
  // the queue row alone is inert, so an urgent notification would sit pending
  // until a digest sweep. `notification.send_email` is org-gated at execution,
  // so enqueuing here is safe even when a tenant has email disabled.
  const { URGENT_EMAIL_JOB_NAME: URGENT_EMAIL_JOB } =
    await import('#/contexts/notification/infrastructure/jobs/urgent-email.job')
  const { jobEnqueueOptions: urgentEnqueueOptions } =
    await import('#/shared/jobs/job-policy')
  const insertNotifHandler = createInsertNotificationHandler({
    notificationRepo: container.notificationRepo,
    emailRepo: container.notificationEmailRepo,
    preferenceRepo: container.notificationPrefRepo,
    clock: container.clock,
    idGen: () => notificationId(crypto.randomUUID()),
    emailIdGen: () => notificationEmailId(crypto.randomUUID()),
    logger: container.logger,
    enqueueImmediateEmail: container.jobQueue
      ? async (data) => {
          await container.jobQueue!.add(
            URGENT_EMAIL_JOB,
            {
              ...data,
              ...createJobExecutionEnvelope({
                organizationId: data.organizationId,
                propertyId: data.propertyId,
                capability: 'notification.send_email',
                initiator: { kind: 'system', id: 'notification:urgent-enqueue' },
                correlationId: `notification-email:${data.notificationEmailId}`,
              }),
            },
            { ...urgentEnqueueOptions(URGENT_EMAIL_JOB) },
          )
        }
      : undefined,
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

  // Outbound email is blocked (notification.send_email) for beta —
  // registerCapabilityGatedJob installs a logging no-op below when it is dark,
  // so a queued urgent email stays `pending` rather than being delivered. The
  // transport decision logged above is orthogonal: the gate decides whether the
  // JOB runs at all, the transport decides where a running job's mail goes.
  const { createUrgentEmailJobHandler, URGENT_EMAIL_JOB_NAME } =
    await import('#/contexts/notification/infrastructure/jobs/urgent-email.job')
  const urgentEmailHandler = createUrgentEmailJobHandler({
    emailRepo: container.notificationEmailRepo,
    notifRepo: container.notificationRepo,
    userLookup: notifUserLookup,
    emailSender: notifEmailSender,
    logger: container.logger,
    clock: container.clock,
    preferenceRepo: container.notificationPrefRepo,
    resolvePropertyScope: resolveNotificationProperty,
    resolveOrganizationScope: resolveNotificationOrgScope,
    authorizeScope: authorizeUrgentNotification,
    baseUrl: notifBaseUrl,
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
  const digestHandler = createDigestNotificationJobHandler({
    pool: getPool(),
    emailRepo: container.notificationEmailRepo,
    notifRepo: container.notificationRepo,
    userLookup: notifUserLookup,
    emailSender: notifEmailSender,
    logger: container.logger,
    clock: container.clock,
    preferenceRepo: container.notificationPrefRepo,
    resolveOrganizationScope: resolveNotificationOrgScope,
    authorizeScope: createScheduledScopeAuthorizer('system:notification.email_digest'),
    baseUrl: notifBaseUrl,
    enqueueImmediate: async (data) => {
      if (!container.jobQueue) return
      await container.jobQueue.add(
        URGENT_EMAIL_JOB_NAME,
        {
          notificationEmailId: data.notificationEmailId,
          ...createJobExecutionEnvelope({
            organizationId: data.organizationId,
            propertyId: data.propertyId,
            capability: 'notification.send_email',
            initiator: { kind: 'system', id: 'notification:delivery-sweep' },
            correlationId: `notification-email:${data.notificationEmailId}`,
          }),
        },
        jobEnqueueOptions(URGENT_EMAIL_JOB_NAME),
      )
    },
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

  // Global ticks fan out to scoped children; each child re-authorizes the
  // concrete organization/property before governed reads or projection writes.
  registerCapabilityGatedJob('leaderboard.reconcile', 'leaderboard.use', async (job) => {
    const payload = job.data as Readonly<{
      scope?: string
      organizationId?: string
      propertyId?: string
    }>
    if (payload.scope === 'property' && payload.organizationId && payload.propertyId) {
      await container.useCases.reconcileRecognition(
        payload.organizationId,
        payload.propertyId,
      )
      return
    }

    const recognitionQueue = container.jobQueue
    if (!recognitionQueue) {
      throw new Error('recognition scoped reconciliation queue unavailable')
    }

    const scopes = await container.useCases.listRecognitionScopes()
    for (const scope of scopes) {
      await recognitionQueue.add(
        'leaderboard.reconcile',
        {
          ...createJobExecutionEnvelope({
            organizationId: scope.organizationId,
            propertyId: scope.propertyId,
            capability: 'leaderboard.use',
            initiator: { kind: 'system', id: 'recognition:hourly-tick' },
            correlationId: `recognition:${scope.organizationId}:${scope.propertyId}`,
          }),
        },
        jobEnqueueOptions('leaderboard.reconcile'),
      )
    }
  })
}
