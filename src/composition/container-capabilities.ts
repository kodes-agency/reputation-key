import { randomUUID } from 'node:crypto'
import { createAlertDispatcher } from '#/shared/observability/alert-dispatcher'
import { reportAlertToObservability } from './alert-reporter'
import { createContainerDisposer } from './container-lifecycle'
import { buildIdentityPlatform } from './identity-wiring'
import type { CompositionRuntime } from './runtime'
import type { buildIdentityPorts, wireIdentity } from './identity-wiring'
import type { wireProperty } from './property-wiring'
import type { wirePortal } from './portal-wiring'
import type { wireGuest } from './guest-wiring'
import type { wireIntegration } from './integration-wiring'
import type { wireReview } from './review-wiring'
import type { wireAi } from './ai-wiring'
import type { wireInbox } from './inbox-wiring'
import type { buildReadAndNotifyContexts } from './read-and-notify-contexts'
import type { buildGoogleProviderAuthority } from './google-provider-authority'
import type { buildOperationalReadout } from './operational-readout'
import type { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import type { createConsumerRegistry } from '#/shared/outbox'

type ContainerCapabilitiesInput = {
  runtime: CompositionRuntime
  identityPorts: ReturnType<typeof buildIdentityPorts>
  identity: ReturnType<typeof wireIdentity>
  property: ReturnType<typeof wireProperty>
  portal: ReturnType<typeof wirePortal>
  guest: ReturnType<typeof wireGuest>
  integration: ReturnType<typeof wireIntegration>
  review: ReturnType<typeof wireReview>
  ai: ReturnType<typeof wireAi>
  inbox: ReturnType<typeof wireInbox>
  readAndNotify: ReturnType<typeof buildReadAndNotifyContexts>
  googleProviderAuthority: ReturnType<typeof buildGoogleProviderAuthority>
  operationalReadout: ReturnType<typeof buildOperationalReadout>
  outboxRepo: ReturnType<typeof createOutboxRepository>
  consumerRegistry: ReturnType<typeof createConsumerRegistry>
}

export function buildContainerCapabilities({
  runtime,
  identityPorts,
  identity,
  property,
  portal,
  guest,
  integration,
  review,
  ai,
  inbox,
  readAndNotify,
  googleProviderAuthority,
  operationalReadout,
  outboxRepo,
  consumerRegistry,
}: ContainerCapabilitiesInput) {
  const { db, pool, logger, redis, clock, env, infra, options } = runtime
  const { identityPort } = identityPorts
  const { reporting, goalCorrectionPolicy, feed } = readAndNotify
  const { activity, notification } = feed
  const { providerEphemeralReadiness, providerEphemeralRedis } = googleProviderAuthority
  const { opsQueues, jobDispatchWorkerRuntime, operationsSnapshot, containerShutdown } =
    operationalReadout

  return {
    db,
    pool,
    logger,
    idGen: randomUUID,
    redis,
    outboxRepo,
    clock,
    opsQueues,
    operationsSnapshot,
    guestContactRequestRetentionSweep: guest.contactRequestReadiness.retentionSweep,
    reviewObservationRetentionSweep:
      review.maintenance.observationRetention.sweepExpiredSupersededCopies,
    aiPublicApi: ai.publicApi,
    aiWorkerRuntime: ai.worker,
    // BQC-7.4: one composition-owned dispatcher shares the structured log,
    // Sentry reporter, and optional ALERT_WEBHOOK_URL across evaluation points.
    alertDispatcher: createAlertDispatcher({
      logger,
      clock,
      webhookUrl: env.ALERT_WEBHOOK_URL,
      report: reportAlertToObservability,
    }),
    // The container's one disposer. The web shutdown, the worker drain and
    // closeContainer() all release through it: what the container opened closes
    // before the shared queue connections under it (container-lifecycle.ts).
    shutdown: createContainerDisposer(
      {
        shutdown: containerShutdown,
        jobQueue: infra.jobQueue,
        backgroundQueue: infra.backgroundQueue,
        opsQueues,
        providerEphemeralRedis,
      },
      logger,
    ),
    // ARC-03-T8: the policy trio this container owns. Constructing it installs
    // nothing process-wide — an entry point calls bindProcessPolicies(container)
    // exactly once, so a second container can never silently take over.
    capabilityPolicyStore: identity.policy.capabilityPolicyStore,
    executionPolicy: identity.policy.executionPolicy,
    delayedExecutionPolicy: identity.policy.delayedExecutionPolicy,
    rateLimiter: infra.rateLimiter,
    jobQueue: infra.jobQueue,
    backgroundQueue: infra.backgroundQueue,
    jobRegistry: infra.jobRegistry,
    jobDispatchWorkerRuntime,
    /** Shared issued-object capability used by Identity profile assets and
     * Portal media. The name exposes the port's purpose, not its adapter. */
    assetStorage: portal.uploads.storage,
    /** What still points at an uploaded avatar or logo; the public image route asks it. */
    identityAssetReferences: identity.assetReferences,
    portalWorkerRuntime: Object.freeze({
      revalidateApprovedDestinations: portal.worker.revalidateApprovedDestinations,
      sweepPortalMedia: portal.worker.sweepPortalMedia,
    }),
    /** Operator-only Review repair and lifecycle authority. */
    reviewMaintenanceRuntime: review.maintenance,
    ...(options?.exposeSimulationRuntime
      ? {
          /** Narrow scenario/invariant capabilities, absent from normal app
           * containers even though they share the same deterministic builder. */
          simulationRuntime: Object.freeze({
            review: Object.freeze({
              upsert: (
                ...args: Parameters<typeof review.internal.repos.reviewRepo.upsert>
              ) => review.internal.repos.reviewRepo.upsert(...args),
              findByOrganizationId: (
                ...args: Parameters<
                  typeof review.internal.repos.reviewRepo.findByOrganizationId
                >
              ) => review.internal.repos.reviewRepo.findByOrganizationId(...args),
            }),
            reply: Object.freeze({
              findByReviewId: (
                ...args: Parameters<typeof review.internal.repos.replyRepo.findByReviewId>
              ) => review.internal.repos.replyRepo.findByReviewId(...args),
              findCurrentGoogleReplyHeadsByReviewIds: (
                ...args: Parameters<
                  typeof review.internal.repos.replyRepo.findCurrentGoogleReplyHeadsByReviewIds
                >
              ) =>
                review.internal.repos.replyRepo.findCurrentGoogleReplyHeadsByReviewIds(
                  ...args,
                ),
            }),
            inbox: Object.freeze({
              findBySource: (
                ...args: Parameters<typeof inbox.internal.repos.inboxRepo.findBySource>
              ) => inbox.internal.repos.inboxRepo.findBySource(...args),
            }),
          }),
        }
      : {}),
    providerEphemeralReadiness,
    identityPublicApi: identity.publicApi,
    identityWorkerRuntime: identity.worker,
    integrationPublicApi: integration.publicApi,
    integrationWorkerRuntime: integration.worker,
    integrationMaintenanceRuntime: integration.maintenance,
    integrationLifecycleRuntime: integration.lifecycle,
    integrationWebhookRuntime: integration.webhook,
    propertyPublicApi: property.publicApi,
    reviewPublicApi: review.publicApi,
    identityLifecycleRuntime: identity.lifecycle,
    guestPublicApi: guest.publicApi,
    inboxPublicApi: inbox.publicApi,
    /** Cross-context Inbox workflow authority; no request or repair surface. */
    inboxLifecycleRuntime: inbox.lifecycle,
    /** Bounded, operator-only Inbox projection repair authority. */
    inboxMaintenanceRuntime: inbox.maintenance,
    inboxRuntime: inbox.runtime,
    metricPublicApi: reporting.publicApi,
    metricMaintenanceRuntime: reporting.maintenance,
    dashboardPublicApi: reporting.publicApi,
    goalPublicApi: reporting.publicApi,
    goalWorkerRuntime: reporting.worker,
    feedPublicApi: feed.publicApi,
    identityPort,
    // Request-scoped Identity handlers consume only their parsed, semantic
    // key material. They never re-read process configuration after boot.
    identityRequestSecurity: Object.freeze({
      invitationRateLimitHmacSecret: env.BETTER_AUTH_SECRET,
      betaFeedbackHmacSecret: env.BETTER_AUTH_SECRET,
    }),
    identityBetaFeedback: identity.betaFeedback,
    identityProductUpdates: identity.productUpdates,
    // ADR 0065: the platform operator console. Off identityPublicApi — no
    // context receives it; only its server functions, after
    // requirePlatformOperator.
    identityPlatform: buildIdentityPlatform(runtime),
    // BQC-2.7: least-privilege policy administration operations.
    policyAdmin: identity.policy.admin,
    portalPublicApi: portal.publicApi,
    notificationWorkerRuntime: Object.freeze({
      notificationRepo: notification.delivery.repos.notificationRepo,
      emailRepo: notification.delivery.repos.emailRepo,
      preferenceRepo: notification.delivery.repos.preferenceRepo,
      // Rechecked immediately before every Property-scoped email is sent.
      recipientStanding: notification.delivery.recipientStanding,
      // Whether the work a notice asks for still waits: asked before it is
      // written and again before its email is sent.
      workState: notification.delivery.workState,
      // A review's eligible rating, to route its notice as a Low ratings one.
      ratingForRouting: notification.delivery.ratingForRouting,
    }),
    handleResendEvent: notification.delivery.handleResendEvent,
    notificationAudienceAuthorizer: notification.delivery.authorizeAudience,
    notificationDeliverySettlement: notification.delivery.deliverySettlement,
    // The repair sweep for notification deliveries that never settled
    // (registered by bootstrap on the worker path). Undefined when no job
    // queue exists.
    reconcileMissingNotificationsHandler:
      notification.delivery.reconcileMissingNotificationsHandler,
    // BQC-2.2: version-gated strong read of persisted policy state.
    // Workers await this before starting; side-effect paths use it for
    // fresh reads (BQC-2.5). Owned by the identity build (readiness).
    refreshPolicyStore: identity.policy.refresh,
    // `providerSubjectKeys` is always a service — the real keyring-backed one
    // when the writer material is configured, otherwise the secret-free deny
    // adapter whose acquireDeriver() throws `config_invalid`. So this IS the
    // boot-time inventory-parity check: it verifies the decoded worker key set
    // against the database's masked inventory before any job runs. The
    // env-level precondition is enforced earlier, at container construction
    // (assertReviewProviderSubjectKeysConfigured).
    refreshReviewProviderSubjectKeys: review.worker.refreshProviderSubjectKeys,
    registerReviewWorkerJobs: ({
      reviewDiscoveryIntervalMs,
      reviewDiscoverySkipRecentlyReconciled,
      reviewHeadChecks,
      reviewReconcileWithinMs,
    }: {
      reviewDiscoveryIntervalMs: number
      reviewDiscoverySkipRecentlyReconciled: boolean
      reviewHeadChecks: 'off' | 'dark' | 'persist'
      reviewReconcileWithinMs: number
    }) =>
      review.worker.registerWorkerJobs({
        discoveryIntervalMs: reviewDiscoveryIntervalMs,
        discoverySkipRecentlyReconciled: reviewDiscoverySkipRecentlyReconciled,
        headChecks: reviewHeadChecks,
        reconcileWithinMs: reviewReconcileWithinMs,
      }),
    /** ARC-03-T7: the durable consumer registry this container owns. */
    consumerRegistry,
    // Worker-only durable consumer registration contributed by owning contexts.
    // Every context registers into THIS container's registry.
    registerOutboxConsumers: () => {
      integration.worker.registerOutboxConsumers(consumerRegistry)
      review.worker.registerOutboxConsumers(consumerRegistry)
      portal.worker.registerOutboxConsumers(consumerRegistry)
      property.worker.registerOutboxConsumers(consumerRegistry)
      inbox.worker.registerOutboxConsumers(consumerRegistry)
      reporting.worker.registerOutboxConsumers(consumerRegistry, goalCorrectionPolicy)
      ai.worker.registerOutboxConsumers(consumerRegistry)
      activity.worker.registerOutboxConsumers(consumerRegistry)
      notification.worker.registerOutboxConsumers(consumerRegistry)
    },
    providerEphemeralRedis,
  } as const
}
