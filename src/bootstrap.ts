// Bootstrap — registers event handlers and background jobs at startup.
// This is separate from composition.ts so that construction and registration
// are easy to understand independently.
//
// Per architecture: "Keeping registration separate from construction
// makes both easier to understand."

import type { Container } from './composition'
import { createHealthCheckHandler, JOB_NAME } from '#/shared/jobs/health-check.job'
import { isDbHealthy } from '#/shared/health/db-probe'
import { areRedisDependenciesHealthy } from '#/shared/health/redis-dependencies'
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
import { createGoogleOAuthExchangeRecoveryRepository } from '#/contexts/integration/infrastructure/repositories/google-oauth-exchange-recovery.repository'
import { createGoogleDisconnectRevokeRepository } from '#/contexts/integration/infrastructure/repositories/google-disconnect-revoke.repository'
import {
  createRecoverInvitedRegistrationsHandler,
  JOB_NAME as RECOVER_INVITED_REGISTRATIONS_JOB,
} from '#/contexts/identity/infrastructure/jobs/recover-invited-registrations.job'
import {
  createAdvanceOrganizationLifecycleHandler,
  JOB_NAME as ADVANCE_ORGANIZATION_LIFECYCLE_JOB,
} from '#/contexts/identity/infrastructure/jobs/advance-organization-lifecycle.job'
import {
  createGenerateOrganizationExportHandler,
  JOB_NAME as GENERATE_ORGANIZATION_EXPORT_JOB,
} from '#/contexts/identity/infrastructure/jobs/generate-organization-export.job'
import {
  createPurgeExpiredOrganizationExportsHandler,
  JOB_NAME as PURGE_EXPIRED_ORGANIZATION_EXPORTS_JOB,
} from '#/contexts/identity/infrastructure/jobs/purge-expired-organization-exports.job'
import {
  createAiOperationExecutionReaperHandler,
  JOB_NAME as AI_EXECUTION_REAPER_JOB_NAME,
} from '#/shared/jobs/ai-operation-execution-reaper.job'
import {
  createAiReviewAnalysisBackfillAdvanceHandler,
  JOB_NAME as AI_BACKFILL_ADVANCE_JOB_NAME,
} from '#/shared/jobs/ai-review-analysis-backfill-advance.job'
import {
  createAiReviewAnalysisEnrollmentSweepHandler,
  JOB_NAME as AI_ENROLLMENT_SWEEP_JOB_NAME,
} from '#/shared/jobs/ai-review-analysis-enrollment-sweep.job'
import {
  createAiAuthorizationErasureHandler,
  JOB_NAME as AI_AUTHORIZATION_ERASURE_JOB_NAME,
} from '#/shared/jobs/ai-authorization-erasure.job'
import { createAiOperationExecutionReaper } from '#/contexts/ai/application/ai-operation-execution-reaper'
import { createAiOperationStoreAdapter } from '#/contexts/ai/infrastructure/adapters/ai-operation-store.adapter'
import {
  AI_AUTHORIZATION_ERASURE_DEFAULT_BATCH_SIZE,
  createEraseAiAuthorizationDerivatives,
} from '#/contexts/ai/application/use-cases/erase-ai-authorization-derivatives'
import { createAiAuthorizationErasureAdapter } from '#/contexts/ai/infrastructure/adapters/ai-authorization-erasure.adapter'
import type { Env } from '#/shared/config/env'
import { writeWorkerHeartbeat } from '#/shared/health/worker-heartbeat'
import {
  createRefreshRollupHandler,
  JOB_NAMES,
} from '#/contexts/metric/infrastructure/jobs/refresh-materialized-view.job'
import { createScheduledScopeAuthorizer } from '#/shared/jobs/delayed-execution-gate'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import {
  createGeneratePropertyTrendJobHandler,
  GENERATE_PROPERTY_TREND_JOB_NAME,
} from '#/contexts/ai/infrastructure/jobs/generate-property-trend.job'
import {
  createSchedulePropertyTrendsJobHandler,
  SCHEDULE_PROPERTY_TRENDS_JOB_NAME,
} from '#/contexts/ai/infrastructure/jobs/schedule-property-trends.job'
import {
  GoalProgramError,
  type GoalExecutionPolicy,
} from '#/contexts/goal/application/public-api'
import {
  createRevalidateApprovedDestinationsHandler,
  JOB_NAME as PORTAL_DESTINATION_REVALIDATION_JOB,
} from '#/contexts/portal/infrastructure/jobs/revalidate-approved-destinations.job'
import {
  createCleanupPortalUploadSourcesHandler,
  JOB_NAME as PORTAL_UPLOAD_SOURCE_CLEANUP_JOB,
} from '#/contexts/portal/infrastructure/jobs/cleanup-upload-sources.job'
import {
  createReleaseResponseTargetRemindersHandler,
  JOB_NAME as RELEASE_RESPONSE_TARGET_REMINDERS_JOB,
} from '#/contexts/inbox/infrastructure/jobs/release-response-target-reminders.job'

// BQC-5.5: the ops queue read handles are composition-owned (container.opsQueues)
// — the per-module getOpsQueues() duplicate is gone. The health-check job
// consumes the same read-only handles as /api/health/metrics.

export type BootstrapRuntimeConfig = Readonly<{
  reviewDiscoveryIntervalMs: number
  quarantineTtlMs: number
  notification: Readonly<{
    nodeEnv: Env['NODE_ENV']
    resendApiKey: string
    resendBaseUrl?: string
    emailFrom: string
    appBaseUrl: string
    unsubscribeHmacKeys?: string
  }>
}>

/** Convert the validated process environment to the exact worker inputs once. */
export const createBootstrapRuntimeConfig = (env: Env): BootstrapRuntimeConfig => ({
  reviewDiscoveryIntervalMs: env.REVIEW_DISCOVERY_INTERVAL_MINUTES * 60 * 1_000,
  quarantineTtlMs: env.QUARANTINE_TTL_DAYS * 24 * 60 * 60 * 1_000,
  notification: {
    nodeEnv: env.NODE_ENV,
    resendApiKey: env.RESEND_API_KEY,
    ...(env.RESEND_BASE_URL ? { resendBaseUrl: env.RESEND_BASE_URL } : {}),
    emailFrom: env.EMAIL_FROM,
    appBaseUrl: env.BETTER_AUTH_URL,
    ...(env.NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS
      ? { unsubscribeHmacKeys: env.NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS }
      : {}),
  },
})

/**
 * BQR-0: registers a job only when its capability is globally enabled.
 * Dark/blocked work has no executable handler.
 */
type CapabilityGatedJobRegistrar = (
  jobName: string,
  capability: Capability,
  handler: (job: import('bullmq').Job) => Promise<void>,
) => void

export async function bootstrap(
  container: Container,
  options: Readonly<{
    runtime: BootstrapRuntimeConfig
    allowUnavailableGoogleImportV2Processor?: boolean
  }>,
): Promise<void> {
  const logger = container.logger
  const runtime = options.runtime

  /**
   * BQR-0: Register a job only when its capability is globally enabled.
   * Dark/blocked work has no executable handler. Scheduler reconciliation
   * removes repeat registrations; any already-queued remnant fails unknown-job
   * admission and is quarantined instead of being acknowledged as successful.
   */
  function registerCapabilityGatedJob(
    jobName: string,
    capability: Capability,
    handler: (job: import('bullmq').Job) => Promise<void>,
  ): void {
    if (!isCapabilityJobEnabled(capability)) {
      logger.info(
        { job: jobName, capability },
        'job handler not registered (capability dark/blocked)',
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
    redisHealthy: areRedisDependenciesHealthy,
    logger,
    clock: container.clock,
    // BQR-6.2: stamp worker liveness for /api/health/metrics
    recordHeartbeat: () =>
      writeWorkerHeartbeat(container.redis ?? undefined, container.clock),
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

  registerCapabilityGatedJob(
    PORTAL_DESTINATION_REVALIDATION_JOB,
    'portal.write',
    createRevalidateApprovedDestinationsHandler({
      revalidate: container.portalWorkerRuntime.revalidateApprovedDestinations,
      authorizeScope: createScheduledScopeAuthorizer(
        'system:portal.destination_revalidate',
      ),
      logger: container.logger,
    }),
  )
  logger.info(
    { job: PORTAL_DESTINATION_REVALIDATION_JOB },
    'registered Portal approved-destination revalidation job handler',
  )

  container.jobRegistry.register(
    RECOVER_INVITED_REGISTRATIONS_JOB,
    createRecoverInvitedRegistrationsHandler({
      recover: container.identityWorkerRuntime.recoverInvitedRegistrations,
      logger: container.logger,
    }),
  )
  logger.info(
    { job: RECOVER_INVITED_REGISTRATIONS_JOB },
    'registered invited registration recovery job handler',
  )

  // LIF-01: these three safety handlers are registered so stale/older queued
  // work has an explicit no-mutation landing. Their catalogue posture is
  // quarantined, therefore scheduler reconciliation removes every recurrence
  // until the named Identity runtime reports complete reviewed bindings.
  container.jobRegistry.register(
    ADVANCE_ORGANIZATION_LIFECYCLE_JOB,
    createAdvanceOrganizationLifecycleHandler({
      ...(container.identityLifecycleRuntime.maintenance.runScheduledPass
        ? {
            advance: container.identityLifecycleRuntime.maintenance.runScheduledPass,
          }
        : {}),
      logger: container.logger,
    }),
  )
  const organizationExportService =
    container.identityLifecycleRuntime.organizationExport.service
  container.jobRegistry.register(
    GENERATE_ORGANIZATION_EXPORT_JOB,
    createGenerateOrganizationExportHandler({
      ...(organizationExportService
        ? { generateNext: () => organizationExportService.generateNext() }
        : {}),
      logger: container.logger,
    }),
  )
  container.jobRegistry.register(
    PURGE_EXPIRED_ORGANIZATION_EXPORTS_JOB,
    createPurgeExpiredOrganizationExportsHandler({
      ...(organizationExportService
        ? { purgeNextExpired: () => organizationExportService.purgeNextExpired() }
        : {}),
      logger: container.logger,
    }),
  )
  logger.info(
    {
      jobs: [
        ADVANCE_ORGANIZATION_LIFECYCLE_JOB,
        GENERATE_ORGANIZATION_EXPORT_JOB,
        PURGE_EXPIRED_ORGANIZATION_EXPORTS_JOB,
      ],
      lifecycleConfigured:
        container.identityLifecycleRuntime.maintenance.readiness.configured,
      exportConfigured:
        container.identityLifecycleRuntime.organizationExport.readiness.configured,
    },
    'registered quarantined Organization lifecycle safety handlers',
  )

  // ── Portal image processing job (portal dark / portal.upload blocked) ──
  const processImageHandler = createProcessImageJob({
    storage: container.portalWorkerRuntime.storage,
    uploadStore: container.portalWorkerRuntime.uploadStore,
    clock: container.clock,
    logger: container.logger,
  })
  registerCapabilityGatedJob(PROCESS_IMAGE_JOB_NAME, 'portal.upload', async (job) => {
    await processImageHandler(
      job as import('bullmq').Job<
        import('#/contexts/portal/infrastructure/jobs/process-image.job').ProcessImageJobData
      >,
    )
  })

  // Cleanup remains active while uploads are dark. Capability shutdown must
  // stop new processing without stranding expired/rejected private sources.
  container.jobRegistry.register(
    PORTAL_UPLOAD_SOURCE_CLEANUP_JOB,
    createCleanupPortalUploadSourcesHandler({
      storage: container.portalWorkerRuntime.storage,
      uploadStore: container.portalWorkerRuntime.uploadStore,
      clock: container.clock,
      logger: container.logger,
    }),
  )
  logger.info(
    { job: PORTAL_UPLOAD_SOURCE_CLEANUP_JOB },
    'registered Portal private upload source cleanup job handler',
  )

  const processGoogleImportV2Item = container.integrationWorkerRuntime.processImportItem
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
        store: createGoogleImportV2Store(container.db, container.clock),
        clock: container.clock,
      }),
      logger: container.logger,
    }),
  )

  await container.registerReviewWorkerJobs({
    reviewDiscoveryIntervalMs: runtime.reviewDiscoveryIntervalMs,
  })

  container.jobRegistry.register(
    RELEASE_RESPONSE_TARGET_REMINDERS_JOB,
    createReleaseResponseTargetRemindersHandler({
      release: container.inboxRuntime.releaseDueResponseTargetReminders,
      logger: container.logger,
    }),
  )
  logger.info(
    { job: RELEASE_RESPONSE_TARGET_REMINDERS_JOB },
    'registered response-target reminder release job handler',
  )

  const generatePropertyTrendHandler = createGeneratePropertyTrendJobHandler({
    generatePropertyTrend: container.aiWorkerRuntime.generatePropertyTrend,
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
    idGen: () => crypto.randomUUID(),
    schedulePropertyTrends: container.aiWorkerRuntime.schedulePropertyTrends,
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

  // ── Register event handlers here as contexts are added ────────────
  // Example:
  //   container.eventBus.on('portal.created', (event) => { ... })

  // ── Metric incremental rollup refresh jobs ─────────────────────────
  const metricRollupDeps = { db: container.db, logger: container.logger }
  for (const [queryKey, jobName] of [
    ['dailyMetrics', JOB_NAMES.refreshDailyMetrics],
    ['weeklyMetrics', JOB_NAMES.refreshWeeklyMetrics],
    ['dailyInboxMetrics', JOB_NAMES.refreshDailyInboxMetrics],
  ] as const) {
    const handler = createRefreshRollupHandler(metricRollupDeps, queryKey)
    container.jobRegistry.register(jobName, handler)
    logger.info({ job: jobName }, 'registered metric rollup refresh job handler')
  }

  // ── Canonical monthly Goal Program maintenance ───────────────────
  // The dispatch gate authorizes this tenant-cross enumeration. The service
  // then re-authorizes every discovered property immediately before reading
  // its governed Metric source or mutating its Goal Program lifecycle.
  const authorizeGoalProgramScope = createScheduledScopeAuthorizer('system:goal.maintain')
  const goalProgramPolicy: GoalExecutionPolicy = {
    authorize: async (request) => {
      if (request.actor !== 'system') throw new GoalProgramError('forbidden')
      const allowed = await authorizeGoalProgramScope(
        request.organizationId,
        request.propertyId,
      )
      if (!allowed) throw new GoalProgramError('forbidden')
    },
  }
  const goalProgramMaintenance = container.goalWorkerRuntime.programMaintenance
  const goalProgramMaintenanceHandler =
    goalProgramMaintenance.createHandler(goalProgramPolicy)
  registerCapabilityGatedJob(goalProgramMaintenance.jobName, 'goal.use', async (job) => {
    await goalProgramMaintenanceHandler(job)
  })
  logger.info(
    { job: goalProgramMaintenance.jobName },
    'registered canonical Goal Program maintenance job handler',
  )

  // ── Retention sweep (BQC-1.6: bounded, evidence-backed, daily) ──────
  const { createRetentionSweepHandler, JOB_NAME: RETENTION_SWEEP_JOB_NAME } =
    await import('#/shared/jobs/retention-sweep.job')
  const retentionSweepHandler = createRetentionSweepHandler({
    db: container.db,
    clock: container.clock,
    googleImportLifecycleSweep:
      container.integrationWorkerRuntime.sweepImportLifecycle ?? undefined,
    guestContactRequestRetentionSweep: container.guestContactRequestRetentionSweep,
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
        ttlMs: runtime.quarantineTtlMs,
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
  const permitStartDeadlineSweep = createPermitStartDeadlineSweepHandler({
    sweep: createExecutionPermitStartDeadlineSweeper({
      store: createGoogleContentAuthorityRepository(container.db),
      clock: container.clock,
    }),
  })
  const oauthExchangeRecovery = createGoogleOAuthExchangeRecoveryRepository(container.db)
  const disconnectRevokeRecovery = createGoogleDisconnectRevokeRepository(
    container.db,
    container.eventBus,
  )
  container.jobRegistry.register(PERMIT_START_DEADLINE_SWEEP_JOB_NAME, async (job) => {
    await permitStartDeadlineSweep(job)
    const now = container.clock()
    const [oauth, revoke] = await Promise.all([
      oauthExchangeRecovery.expire({ now, limit: 100 }),
      disconnectRevokeRecovery.reconcileElapsed({ now, limit: 100 }),
    ])
    // Counts only: no tenant, connection, attempt, permit, credential binding,
    // provider response, or outcome payload reaches observability.
    logger.info(
      {
        job: PERMIT_START_DEADLINE_SWEEP_JOB_NAME,
        oauthExchangeAttemptsExpired: oauth.expired,
        disconnectAttemptsVisited: revoke.visited,
        disconnectConfirmedNotSent: revoke.confirmedNotSent,
        disconnectCleanupAmbiguous: revoke.cleanupAmbiguous,
      },
      'Google provider recovery sweep completed',
    )
  })
  logger.info(
    { job: PERMIT_START_DEADLINE_SWEEP_JOB_NAME },
    'registered permit start-deadline sweep job handler',
  )

  // ── AI authorization-derivative physical erasure ─────────────────
  // Local Review Analysis, Property aggregate, and Property Trend
  // generations are hidden synchronously at authorization change. This
  // unconditional worker independently converges their physical deletion;
  // switching AI execution off must never switch cleanup off with it.
  const aiAuthorizationErasureStore = createAiAuthorizationErasureAdapter(container.db)
  container.jobRegistry.register(
    AI_AUTHORIZATION_ERASURE_JOB_NAME,
    createAiAuthorizationErasureHandler({
      db: container.db,
      clock: container.clock,
      batchSize: AI_AUTHORIZATION_ERASURE_DEFAULT_BATCH_SIZE,
      erase: () =>
        createEraseAiAuthorizationDerivatives({
          store: aiAuthorizationErasureStore,
          clock: container.clock,
          leaseOwner: crypto.randomUUID(),
          batchSize: AI_AUTHORIZATION_ERASURE_DEFAULT_BATCH_SIZE,
        })(),
    }),
  )
  logger.info(
    { job: AI_AUTHORIZATION_ERASURE_JOB_NAME },
    'registered AI authorization derivative erasure job handler',
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
        store: createAiOperationStoreAdapter(container.db, () => crypto.randomUUID()),
        nowEpochMillis: () => container.clock().getTime(),
      }),
    }),
  )
  logger.info(
    { job: AI_EXECUTION_REAPER_JOB_NAME },
    'registered AI operation abandoned-execution reaper job handler',
  )

  // ── AI review-analysis backfill advance sweep ─────────────────────
  // A backfill run may only ever have ONE review in flight, so each item is
  // handed the next by the outbox consumer the moment it settles. This sweep
  // covers the hand-off the consumer cannot: a worker that died between the
  // settle and the hand-off, or a dispatch budget exhausted on one event.
  // Registered unconditionally for the same reason as the reaper above — a run
  // left open has already moved the property's analysis watermark, so the
  // reviews it skipped are reachable through nothing else.
  container.jobRegistry.register(
    AI_BACKFILL_ADVANCE_JOB_NAME,
    createAiReviewAnalysisBackfillAdvanceHandler({
      sweep: container.aiWorkerRuntime.advanceReviewAnalysisBackfill.sweep,
    }),
  )
  logger.info(
    { job: AI_BACKFILL_ADVANCE_JOB_NAME },
    'registered AI review-analysis backfill advance job handler',
  )

  // ── AI first-enablement enrollment recovery ───────────────────────
  // Enrollment intent is durable, but capturing it does not activate provider
  // execution. The owning use case rechecks the exact authorization lineage,
  // source/capability epochs, and current global/provider/capability controls
  // for every head before opening a replay. Registration therefore remains
  // unconditional: when execution is dark, the tick records runtimeBlocked and
  // leaves the enrollment queued instead of silently stranding it.
  container.jobRegistry.register(
    AI_ENROLLMENT_SWEEP_JOB_NAME,
    createAiReviewAnalysisEnrollmentSweepHandler({
      sweep: container.aiWorkerRuntime.advanceReviewAnalysisEnrollments.sweep,
      logger: container.logger,
    }),
  )
  logger.info(
    { job: AI_ENROLLMENT_SWEEP_JOB_NAME },
    'registered AI Review Analysis enrollment sweep job handler',
  )

  // ── Recent Activity projection job ────────────────────────────────
  const { PROJECT_RECENT_ACTIVITY_JOB_NAME, LEGACY_INSERT_ACTIVITY_LOG_JOB_NAME } =
    await import('#/contexts/activity/infrastructure/jobs/project-recent-activity.job')
  // ARC-03-T12: Activity owns the projection. The worker's job is transport
  // only — it unwraps the BullMQ envelope and calls the context capability.
  const projectRecentActivityHandler = async (
    job: import('bullmq').Job<
      import('#/contexts/activity/infrastructure/jobs/project-recent-activity.job').ProjectRecentActivityJobData
    >,
  ): Promise<void> => {
    await container.activityWorkerRuntime.projectRecentActivity(job.data)
  }
  container.jobRegistry.register(
    PROJECT_RECENT_ACTIVITY_JOB_NAME,
    async (job): Promise<void> => {
      await projectRecentActivityHandler(
        job as import('bullmq').Job<
          import('#/contexts/activity/infrastructure/jobs/project-recent-activity.job').ProjectRecentActivityJobData
        >,
      )
    },
  )
  // Drain-only rolling compatibility. Current producers enqueue only the
  // canonical name, but already-persisted queue items must remain processable.
  container.jobRegistry.register(
    LEGACY_INSERT_ACTIVITY_LOG_JOB_NAME,
    async (job): Promise<void> => {
      await projectRecentActivityHandler(
        job as import('bullmq').Job<
          import('#/contexts/activity/infrastructure/jobs/project-recent-activity.job').ProjectRecentActivityJobData
        >,
      )
    },
  )
  logger.info(
    {
      job: PROJECT_RECENT_ACTIVITY_JOB_NAME,
      legacyDrainJob: LEGACY_INSERT_ACTIVITY_LOG_JOB_NAME,
    },
    'registered Recent Activity projection and rolling drain handlers',
  )

  await registerNotificationJobs(container, runtime, registerCapabilityGatedJob)
}

/**
 * The notification job family: outbound transport selection, one-click
 * unsubscribe signing, the insert handler, the notification-gap healing sweep,
 * and the two capability-gated outbound-email handlers.
 *
 * It is a separate unit because every declaration below is used only by this
 * family — nothing in the rest of the worker's registration reads them.
 */
async function registerNotificationJobs(
  container: Container,
  runtime: BootstrapRuntimeConfig,
  registerCapabilityGatedJob: CapabilityGatedJobRegistrar,
): Promise<void> {
  const logger = container.logger
  const { createInsertNotificationHandler, INSERT_NOTIFICATION_JOB_NAME } =
    await import('#/contexts/notification/infrastructure/jobs/insert-notification.job')
  const { createDbUserLookupAdapter: createNotifUserLookup } =
    await import('#/contexts/notification/infrastructure/adapters/db-user-lookup.adapter')
  const { createResendEmailAdapter } =
    await import('#/contexts/notification/infrastructure/adapters/resend-email.adapter')
  const { notificationId, notificationEmailId } = await import('#/shared/domain/ids')
  const notifUserLookup = createNotifUserLookup(container.db)
  // Outbound email transport is chosen ONCE, here, and logged loudly. Before
  // this the real Resend adapter was constructed unconditionally, so a local
  // boot with a real key in .env mailed real inboxes, and a boot with the
  // .env.example placeholder failed deep inside a BullMQ job instead of at
  // wiring time. Rules live in shared/email/transport-selection.ts.
  const { decideEmailTransport } = await import('#/shared/email/transport-selection')
  const { createCapturingEmailSender } =
    await import('#/contexts/notification/infrastructure/adapters/capturing-email-sender.adapter')
  const emailTransport = decideEmailTransport({
    NODE_ENV: runtime.notification.nodeEnv,
    RESEND_API_KEY: runtime.notification.resendApiKey,
    ...(runtime.notification.resendBaseUrl
      ? { RESEND_BASE_URL: runtime.notification.resendBaseUrl }
      : {}),
  })
  const notifEmailSender =
    emailTransport.mode === 'capture'
      ? createCapturingEmailSender({ clock: container.clock })
      : createResendEmailAdapter({
          config: {
            apiKey: runtime.notification.resendApiKey,
            ...(runtime.notification.resendBaseUrl
              ? { baseUrl: runtime.notification.resendBaseUrl }
              : {}),
            from: runtime.notification.emailFrom,
            appBaseUrl: runtime.notification.appBaseUrl,
          },
          logger,
          clock: container.clock,
        })
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
  const notifBaseUrl = runtime.notification.appBaseUrl
  const unsubscribeKeys = runtime.notification.unsubscribeHmacKeys
  if (isCapabilityJobEnabled('notification.send_email') && !unsubscribeKeys) {
    throw new Error(
      '[CONFIG] notification.send_email requires NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS',
    )
  }
  const { activeOneClickUnsubscribeKeyVersion, oneClickUnsubscribeUrl } =
    await import('#/contexts/notification/application/one-click-unsubscribe-token')
  const notificationUnsubscribeUrl = (
    target: Parameters<typeof oneClickUnsubscribeUrl>[2],
    keyVersion?: string,
  ): string => {
    if (!unsubscribeKeys) {
      throw new Error('One-click unsubscribe signing keys are unavailable')
    }
    return oneClickUnsubscribeUrl(notifBaseUrl, unsubscribeKeys, target, keyVersion)
  }
  const notificationUnsubscribeKeyVersion = (): string => {
    if (!unsubscribeKeys) {
      throw new Error('One-click unsubscribe signing keys are unavailable')
    }
    return activeOneClickUnsubscribeKeyVersion(unsubscribeKeys)
  }
  const { createNotificationPropertyScopeResolver } =
    await import('#/contexts/notification/infrastructure/repositories/notification-property-scope.repository')
  const { createNotificationOrganizationScopeResolver } =
    await import('#/contexts/notification/infrastructure/repositories/notification-organization-scope.repository')
  const resolveNotificationProperty = createNotificationPropertyScopeResolver(
    container.pool,
  )
  // ADR 0046 r.3: the organization fallback timezone plus property display
  // names for digest grouping.
  const resolveNotificationOrgScope = createNotificationOrganizationScopeResolver(
    container.pool,
  )
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
    notificationRepo: container.notificationWorkerRuntime.notificationRepo,
    emailRepo: container.notificationWorkerRuntime.emailRepo,
    preferenceRepo: container.notificationWorkerRuntime.preferenceRepo,
    clock: container.clock,
    idGen: () => notificationId(crypto.randomUUID()),
    emailIdGen: () => notificationEmailId(crypto.randomUUID()),
    logger: container.logger,
    authorizeAudience: container.notificationAudienceAuthorizer,
    deliverySettlement: container.notificationDeliverySettlement,
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

  // ── Notification-gap healing sweep ───────────────────────────────
  // `emitAfterCommit` catches and warns, so a throw in the inbox or
  // notification handler used to leave a committed review with no notification
  // and nothing retrying. This sweep finds those items and enqueues the
  // notification they never got. It is the LIVE repair path: the durable
  // consumer that would prevent the loss is registered but inert while
  // OUTBOX_DISPATCHER_ENABLED is false.
  const { JOB_NAME: RECONCILE_MISSING_NOTIFICATIONS_JOB_NAME } =
    await import('#/contexts/notification/infrastructure/jobs/reconcile-missing-notifications.job')
  const reconcileMissingNotifications = container.reconcileMissingNotificationsHandler
  if (reconcileMissingNotifications) {
    container.jobRegistry.register(
      RECONCILE_MISSING_NOTIFICATIONS_JOB_NAME,
      async (job) => {
        await reconcileMissingNotifications(job)
      },
    )
    logger.info(
      { job: RECONCILE_MISSING_NOTIFICATIONS_JOB_NAME },
      'registered reconcile-missing-notifications job handler',
    )
  } else {
    logger.warn(
      { job: RECONCILE_MISSING_NOTIFICATIONS_JOB_NAME },
      'reconcile-missing-notifications not registered — no job queue, so notification gaps will not self-heal',
    )
  }

  // Outbound email is blocked (notification.send_email) for beta. The gated
  // families retain no executable handler, so queued remnants cannot be
  // acknowledged as delivered. The transport decision logged above is
  // orthogonal: the gate decides whether the JOB may exist at runtime, while
  // the transport decides where an admitted job's mail goes.
  const { createUrgentEmailJobHandler, URGENT_EMAIL_JOB_NAME } =
    await import('#/contexts/notification/infrastructure/jobs/urgent-email.job')
  const urgentEmailHandler = createUrgentEmailJobHandler({
    emailRepo: container.notificationWorkerRuntime.emailRepo,
    notifRepo: container.notificationWorkerRuntime.notificationRepo,
    userLookup: notifUserLookup,
    emailSender: notifEmailSender,
    logger: container.logger,
    clock: container.clock,
    preferenceRepo: container.notificationWorkerRuntime.preferenceRepo,
    resolvePropertyScope: resolveNotificationProperty,
    resolveOrganizationScope: resolveNotificationOrgScope,
    authorizeScope: authorizeUrgentNotification,
    baseUrl: notifBaseUrl,
    oneClickUnsubscribeUrl: notificationUnsubscribeUrl,
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
    pool: container.pool,
    emailRepo: container.notificationWorkerRuntime.emailRepo,
    notifRepo: container.notificationWorkerRuntime.notificationRepo,
    userLookup: notifUserLookup,
    emailSender: notifEmailSender,
    logger: container.logger,
    clock: container.clock,
    batchIdGen: () => crypto.randomUUID(),
    preferenceRepo: container.notificationWorkerRuntime.preferenceRepo,
    resolveOrganizationScope: resolveNotificationOrgScope,
    authorizeScope: createScheduledScopeAuthorizer('system:notification.email_digest'),
    baseUrl: notifBaseUrl,
    activeOneClickUnsubscribeKeyVersion: notificationUnsubscribeKeyVersion,
    oneClickUnsubscribeUrl: notificationUnsubscribeUrl,
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
}
