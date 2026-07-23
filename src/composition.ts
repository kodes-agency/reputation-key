// Composition root — selects the enabled context modules and supplies the
// cross-context adapters and true root scalars. This is the only place where
// the full container is built. Both server and worker build it and use it.
//
// Each context's build.ts owns its internal wiring (repos, adapters, use
// cases, event handlers) and exposes only what composition needs: the
// server/application interface (publicApi + internal), plus readiness/runtime
// contributions where required (identity: refreshPolicyStore; inbox:
// registerOutboxConsumers) and the optional shutdown hook (none today).
// The root does NOT import individual use cases, event handlers, or business
// rules. Worker/job/consumer/schedule registration is owned by BQC-3
// (bootstrap.ts + worker/) — the root consumes that runtime registry as one
// accepted interface and never introduces another.
//
// Per architecture: "No DI framework, no auto-wiring, no decorators.
// Dependencies are passed as function arguments. The wiring is in composition.ts, visible."

import { getDb } from '#/shared/db'
import type { Database } from '#/shared/db'
import { getLogger } from '#/shared/observability/logger'
import { getRedis } from '#/shared/cache/redis'
import { createEventBus } from '#/shared/events/event-bus'
import type { EventBus } from '#/shared/events/event-bus'
import { createBusAuthorizer } from '#/shared/jobs/delayed-execution-gate'
import { createRedisCache } from '#/shared/cache/redis-cache'
import { createNoopCache } from '#/shared/cache/noop-cache'
import type { Cache } from '#/shared/cache/cache.port'
import { createRateLimiter } from '#/shared/rate-limit/middleware'
import type { RateLimiter } from '#/shared/rate-limit/middleware'
import { createJobQueue } from '#/shared/jobs/queue'
import { createJobRegistry } from '#/shared/jobs/registry'
import type { JobRegistry } from '#/shared/jobs/registry'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createBetterAuthIdentityAdapter } from '#/contexts/identity/infrastructure/adapters/auth-identity.adapter'
import { createGrantAccessLookup } from '#/contexts/identity/infrastructure/adapters/grant-access-lookup.adapter'
import { registerExecutionPolicyInit } from '#/shared/auth/execution-policy'
import { registerDelayedExecutionPolicyInit } from '#/shared/auth/system-execution-policy'
import type { IdentityPort } from '#/contexts/identity/application/ports/identity.port'
import { buildIdentityContext } from '#/contexts/identity/build'
import {
  getAuth,
  setOnAcceptInvitation,
  INVITATION_EXPIRY_SECONDS,
} from '#/shared/auth/auth'
import { sendInvitationEmail } from '#/shared/auth/emails'
import { headersFromContext } from '#/shared/auth/headers'
import { getEnv } from '#/shared/config/env'
import type { Env } from '#/shared/config/env'
import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Clock } from '#/shared/domain/clock'
import { buildPropertyContext } from '#/contexts/property/build'
import { createPropertyRepository } from '#/contexts/property/infrastructure/repositories/property.repository'
import { createPropertyRoutingLoader } from '#/contexts/property/infrastructure/property-routing.adapter'
import { createPropertyRegionLoader } from '#/contexts/property/infrastructure/property-region-loader'
import { createProcessingRouter } from '#/shared/routing/processing-router'
import { providerRefForCell } from '#/shared/routing/processing-router'
import type { ProviderEndpoints } from '#/shared/routing/processing-router'
import { buildIntegrationContext } from '#/contexts/integration/build'
import { buildTeamContext } from '#/contexts/team/build'
import { buildStaffContext } from '#/contexts/staff/build'
import { buildPortalContext } from '#/contexts/portal/build'
import { buildGuestContext } from '#/contexts/guest/build'
import { buildReviewContext } from '#/contexts/review/build'
import { createSourceContentPurge } from '#/contexts/review/infrastructure/source-content-purge'
import { buildInboxContext } from '#/contexts/inbox/build'
import { buildMetricContext } from '#/contexts/metric/build'
import { buildBadgeContext } from '#/contexts/badge/build'
import { buildLeaderboardContext } from '#/contexts/leaderboard/build'
import { buildDashboardContext } from '#/contexts/dashboard/build'
import { buildGoalContext } from '#/contexts/goal/build'
import { buildActivityContext } from '#/contexts/activity/build'
import { buildNotificationContext } from '#/contexts/notification/build'
import { createStaffAssignmentRepository } from '#/contexts/staff/infrastructure/repositories/staff-assignment.repository'
import { createIdentityMembershipAdapter } from '#/contexts/staff/infrastructure/adapters/identity-membership.adapter'
import {
  propertyId,
  organizationId as toOrgId,
  userId as toUserId,
} from '#/shared/domain/ids'

// ── Infrastructure ─────────────────────────────────────────────────

function buildInfrastructure(options: {
  redis: Redis | undefined
  enableJobs: boolean
  /** Override the queue (simulations inject an in-memory queue). */
  queue?: Queue
  /** Override the background queue (simulations inject an in-memory queue). */
  backgroundQueue?: Queue
}) {
  const cache: Cache = options.redis ? createRedisCache(options.redis) : createNoopCache()
  const rateLimiter: RateLimiter = createRateLimiter(options.redis, {
    keyPrefix: 'ratelimit:public',
    maxRequests: 60,
    windowSeconds: 60,
  })
  // Use the injected queue if provided; otherwise create a BullMQ queue when
  // Redis is available. The web server needs a queue to enqueue jobs; the
  // worker needs one for processing.
  const jobQueue: Queue | undefined =
    options.queue ?? (options.redis ? createJobQueue('default') : undefined)
  // Background queue for cron-scheduled maintenance jobs (health-check, metric
  // refresh, badge/leaderboard reconciliation, etc.). Only created when jobs
  // are enabled (worker process) to avoid an unused Redis connection in the
  // web server.
  const backgroundQueue: Queue | undefined =
    options.backgroundQueue ??
    (options.enableJobs && options.redis ? createJobQueue('background') : undefined)
  const jobRegistry: JobRegistry = createJobRegistry()
  return { cache, rateLimiter, jobQueue, backgroundQueue, jobRegistry }
}

// ── Provider endpoint mapping (BQC-4.3) ────────────────────────────
// The ONE place Google/GBP endpoint URLs exist. ProcessingTarget.provider
// carries a logical reference (from the router's CELL_TARGETS); this mapping
// turns it into adapter construction config. Adapters receive their base URL
// from here alone — no context adapter hardcodes a Google URL, so no code
// path can silently fall back to another endpoint or region (ADR 0031/0048).
// A future cell gets its own ref + entry via an explicit decision record.

const PROVIDER_ENDPOINTS: Readonly<Record<string, ProviderEndpoints>> = {
  'gbp-default': {
    gbpApiBaseUrl: 'https://mybusinessbusinessinformation.googleapis.com/v1',
    reviewsApiBaseUrl: 'https://mybusiness.googleapis.com/v4',
    notificationsApiBaseUrl: 'https://mybusinessnotifications.googleapis.com/v1',
    oauthTokenUrl: 'https://oauth2.googleapis.com/token',
    oauthUserInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    oauthRevokeUrl: 'https://oauth2.googleapis.com/revoke',
  },
}

/**
 * Resolve a logical provider reference to its endpoint construction config.
 * Fails closed: an unknown, denied, or missing ref throws — there is no
 * default endpoint to fall back to.
 */
export function providerConfigFor(ref: string | undefined): ProviderEndpoints {
  const endpoints = ref ? PROVIDER_ENDPOINTS[ref] : undefined
  if (!endpoints) {
    throw new Error(
      `No approved provider configuration for ref '${ref ?? 'none'}' (ADR 0048: provider refs come from the router's CELL_TARGETS)`,
    )
  }
  return endpoints
}

// ── Identity infrastructure helpers ────────────────────────────────

async function setActiveOrg(orgId: string): Promise<void> {
  const auth = getAuth()
  const logger = getLogger()
  try {
    const headers = await headersFromContext()
    await auth.api.setActiveOrganization({
      headers,
      body: { organizationId: orgId },
    })
  } catch (e) {
    // If headers don't carry a valid session (e.g., during registration
    // where cookies aren't yet available), this is non-fatal — the user
    // will set their active org on first login.
    logger.warn({ err: e, orgId }, 'Failed to set active organization during setup')
  }
}

// ── Main container ─────────────────────────────────────────────────

// fallow-ignore-next-line complexity — composition root: per-dependency override pattern is inherently branchy (was already over threshold on main; extraction would scatter the wiring)
export function createContainer(options?: {
  enableJobs?: boolean
  /** Override the database connection (simulations, per-test isolation). */
  db?: Database
  /** Override the Redis client (simulations, deterministic backends). */
  redis?: Redis
  /** Override env (simulations against throwaway config). */
  env?: Env
  /** Override the clock (fast-forward time in tests/simulations). ADR 0017. */
  clock?: Clock
  /** Override the event bus (deterministic in-process delivery). */
  eventBus?: EventBus
  /** Override the job queue (simulations inject an in-memory queue). */
  queue?: Queue
  /** Override the background queue (simulations inject an in-memory queue). */
  backgroundQueue?: Queue
  /** Override the identity port (simulations use the in-memory identity fake). */
  identityPort?: IdentityPort
  /** Override the email sender (simulations capture emails instead of sending). */
  email?: typeof sendInvitationEmail
}) {
  const { enableJobs = false } = options ?? {}
  const db = options?.db ?? getDb()
  const logger = getLogger()
  const redis = options?.redis ?? getRedis()
  // BQC-3.2: the composition root wires the bus authorizer to the delayed
  // execution gate; bare createEventBus() (tests, Storybook, browser) stays
  // ungoverned and free of server-only policy imports.
  const eventBus =
    options?.eventBus ?? createEventBus({ authorizeConsumer: createBusAuthorizer() })
  const clock = options?.clock ?? (() => new Date())
  const env = options?.env ?? getEnv()

  // BQC-4.3: resolve the cell's approved provider endpoints ONCE from the
  // router's cell config (PROCESSING_CELL → logical provider ref → endpoint
  // construction config). Fails closed at startup for a cell with no approved
  // provider — unavailability is never papered over by another endpoint.
  const providerEndpoints = providerConfigFor(providerRefForCell(env.PROCESSING_CELL))

  // Infrastructure
  const infra = buildInfrastructure({
    redis,
    enableJobs,
    queue: options?.queue,
    backgroundQueue: options?.backgroundQueue,
  })

  // Identity port (adapter)
  const identityPort = options?.identityPort ?? createBetterAuthIdentityAdapter(db)

  // BQC-4.2: the ONE routing decision model — shared by the review context
  // (enqueue envelope stamping) and the BQC-4.4 operator region diagnostic.
  const processingRouter = createProcessingRouter({
    loadPropertyRouting: createPropertyRoutingLoader({ db }),
    cell: env.PROCESSING_CELL,
  })

  // PRE17A A4: Create outbox repository and register event schemas.
  // The outbox records domain events durably. Event schemas are registered
  // once at startup so the relay can validate payloads before publishing.
  const outboxRepo = createOutboxRepository(db)
  registerAllEventSchemas()

  // ── Context builds (dependency order) ──────────────────────────────
  const staffRepo = createStaffAssignmentRepository(db)
  const staff = buildStaffContext({
    db,
    repo: staffRepo,
    identityMembership: createIdentityMembershipAdapter(db),
    // BQC-2.3: property scope resolves from the identity-owned grant
    // repository (ADR 0039) — never from staff_assignments.
    accessiblePropertyLookup: createGrantAccessLookup(db),
    // Staff is built before portal (portal depends on staff.publicApi).
    // Late-binding closure: methods resolve portal at call time (runtime),
    // long after createContainer returns — TDZ-safe.
    portalLookup: {
      listPortalIdsByProperty: async (orgId, pid) => {
        const portals = await portal.internal.repos.portalRepo.listByProperty(orgId, pid)
        return portals.map((p) => p.id)
      },
      getPortalInfo: (orgId, portalId) =>
        portal.publicApi.portal.getPortalInfo(orgId, portalId),
    },
    events: eventBus,
    clock,
  })

  const identity = buildIdentityContext({
    db,
    identityPort,
    events: eventBus,
    clock,
    signUp: identityPort.signUp,
    setActiveOrg,
    updateOrg: async (data) => {
      const auth = getAuth()
      const headers = await headersFromContext()
      await auth.api.updateOrganization({ headers, body: { data } })
    },
    sendEmail: options?.email ?? sendInvitationEmail,
    getOrganizationName: async (_ctx) => {
      const auth = getAuth()
      const headers = await headersFromContext()
      const org = await auth.api.getFullOrganization({ headers })
      return org?.name ?? 'Unknown Organization'
    },
    baseUrl: env.BETTER_AUTH_URL,
    invitationExpiresInMs: INVITATION_EXPIRY_SECONDS * 1000,
    deleteUser: identityPort.deleteUser,
    // BQC-2.2/2.7/4.4: identity owns the policy store, admin ops, and the
    // operator audit sink; the root supplies env + the shared routing
    // primitives (property region loader, router decision).
    policy: {
      env,
      loadPropertyRegion: createPropertyRegionLoader({ db }),
      resolveRouting: (pid) => processingRouter.resolve(pid, 'review.sync'),
      cell: env.PROCESSING_CELL,
      providerRef: providerRefForCell(env.PROCESSING_CELL) ?? null,
    },
  })

  // BQC-1.7: the bounded lifecycle purge implementation is review-owned
  // infrastructure — the composition root is the only layer allowed to
  // import it (CONTEXT.md cross-context rule). Constructed ONCE and shared
  // by the property (hard delete) and integration (disconnect) builds.
  const sourceContentPurge = createSourceContentPurge({ db, clock })

  const property = buildPropertyContext({
    db,
    repo: createPropertyRepository(db),
    events: eventBus,
    clock,
    staffPublicApi: staff.publicApi,
    sourceContentPurge,
    // BQC-4.5: region move workflow. Approved cells stay {'us'} (ADR 0048) —
    // every real request denies typed + audited today. The audit sink is the
    // identity-owned policy_decision_audit (content-free, operator kind),
    // exposed by the identity build for injection; the stepper pauses/drains
    // the cell's property-scoped queues.
    regionMove: {
      writeOperatorAudit: identity.internal.writeOperatorAudit,
      queues: [
        { name: 'default', queue: infra.jobQueue },
        { name: 'background', queue: infra.backgroundQueue },
      ],
    },
  })

  const team = buildTeamContext({
    db,
    events: eventBus,
    outboxRepo,
    clock,
    propertyApi: property.publicApi,
    staffApi: staff.publicApi,
  })

  const portal = buildPortalContext({
    db,
    events: eventBus,
    outboxRepo,
    clock,
    propertyApi: property.publicApi,
    staffPublicApi: staff.publicApi,
    baseUrl: env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    idGen: () => crypto.randomUUID(),
    queue: infra.jobQueue,
    storageConfig: {
      accessKey: env.AWS_S3_ACCESS_KEY ?? '',
      secretKey: env.AWS_S3_SECRET_ACCESS_KEY ?? '',
      bucketName: env.AWS_S3_BUCKET_NAME ?? '',
      region: env.AWS_S3_REGION ?? '',
    },
  })

  const guest = buildGuestContext({
    db,
    events: eventBus,
    outboxRepo,
    clock,
    linkResolver: portal.internal.repos.linkResolver,
    portalApi: portal.publicApi.portal,
    logger,
  })

  const integration = buildIntegrationContext({
    db,
    events: eventBus,
    clock,
    jobQueue: infra.jobQueue,
    propertyApi: property.publicApi,
    logger: getLogger(),
    providerEndpoints,
    sourceContentPurge,
  })

  const review = buildReviewContext({
    db,
    events: eventBus,
    clock,
    staffPublicApi: staff.publicApi,
    googleReviewApi: integration.internal.googleReviewApi,
    jobQueue: infra.jobQueue,
    logger: getLogger(),
    // BQC-4.1: review sync asserts the property's region before any external
    // effect; the property context owns the routing fact (ADR 0048).
    propertyApi: property.publicApi,
    // BQC-4.2: stamp the content-free routing envelope at enqueue (telemetry;
    // the worker's dispatch-time routing gate re-resolves and decides).
    processingRouter,
  })

  const inbox = buildInboxContext({
    db,
    events: eventBus,
    clock,
    staffPublicApi: staff.publicApi,
    // BQC-1.4: review.publicApi IS the governed read interface — it satisfies
    // the inbox ReviewLookupPort and metric ReviewRatingLookupPort directly.
    // No per-context eligibility adapters remain (single rule, one owner).
    reviewLookup: review.publicApi,
    // Foreign read sources the inbox build adapts into its lookup ports.
    sources: {
      feedback: guest.internal.repos.guestRepo,
      property: property.publicApi,
      reply: review.internal.repos.replyRepo,
      review: review.internal.repos.reviewRepo,
    },
    logger: getLogger(),
  })

  const metricApi = buildMetricContext({
    db,
    events: eventBus,
    clock,
    portalGroupApi: portal.publicApi.portalGroup,
    reviewRatingLookup: review.publicApi,
  })

  // Goal context — buildGoalContext creates its own repo and cancelGoalFn internally.
  const goal = buildGoalContext({
    db,
    metricApi: metricApi.publicApi,
    events: eventBus,
    outboxRepo,
    clock,
    staffPublicApi: staff.publicApi,
    idGen: () => crypto.randomUUID(),
    getLogger,
    portalGroupApi: portal.publicApi.portalGroup,
  })

  // ── Dashboard context (facade ports per ADR-0007) ────────────────
  // Dashboard never queries review/reply/metric tables directly — the
  // dashboard build constructs its SQL adapters internally.
  const dashboard = buildDashboardContext({
    db,
    staffPublicApi: staff.publicApi,
    clock,
  })

  // ── Activity context ────────────────────────────────────────────
  const activity = buildActivityContext({
    db,
    events: eventBus,
    outboxRepo,
    staffPublicApi: staff.publicApi,
    queue: infra.jobQueue,
    clock,
    logger,
  })

  const badge = buildBadgeContext({
    db,
    events: eventBus,
    outboxRepo,
    clock,
    metricApi: metricApi.publicApi,
  })

  const leaderboard = buildLeaderboardContext({
    db,
    events: eventBus,
    outboxRepo,
    clock,
  })

  // ── Notification context ──────────────────────────────────────────
  const notification = buildNotificationContext({
    db,
    events: eventBus,
    outboxRepo,
    queue: infra.jobQueue,
    clock,
    logger,
  })

  // ── Wire invitation acceptance hook ────────────────────────────
  // The hook creates staff assignments when a member accepts an invite.
  // This is the only cross-context dependency: identity acceptance
  // triggers staff creation. Identity context does NOT import staff.
  //
  // Privileged SYSTEM write, not a user action: it bootstraps an
  // assignment for the invitee. The staff build owns the system use case
  // (skips can(), the membership gate, property-access scoping, and the
  // self-assignment guard BY DESIGN — deep-review §9 AuthContext forgery);
  // the root only registers the cross-context lifecycle hook.
  setOnAcceptInvitation(async ({ userId, organizationId, propertyIds }) => {
    const uid = toUserId(userId)
    const oid = toOrgId(organizationId)
    for (const pid of propertyIds) {
      try {
        await staff.internal.systemStaffAssignment(
          { userId: uid, propertyId: propertyId(pid) },
          { organizationId: oid },
        )
      } catch {
        logger.warn(
          { userId, propertyId: pid },
          'Failed to auto-assign property on invitation acceptance',
        )
      }
    }
  })
  return {
    db,
    logger,
    redis,
    eventBus,
    outboxRepo,
    clock,
    cache: infra.cache,
    rateLimiter: infra.rateLimiter,
    jobQueue: infra.jobQueue,
    backgroundQueue: infra.backgroundQueue,
    jobRegistry: infra.jobRegistry,
    useCases: {
      ...identity.internal.useCases,
      ...property.internal.useCases,
      ...staff.internal.useCases,
      ...team.internal.useCases,
      ...portal.internal.useCases,
      ...guest.internal.useCases,
      ...integration.internal.useCases,
      handleGbpNotification: integration.internal.gbpNotificationHandler({
        reviewQueue: review.internal.repos.queue,
      }),
      syncReviews: review.internal.useCases.syncReviews,
      draftReply: review.internal.useCases.draftReply,
      submitReply: review.internal.useCases.submitReply,
      approveReply: review.internal.useCases.approveReply,
      editPublishedReply: review.internal.useCases.editPublishedReply,
      rejectReply: review.internal.useCases.rejectReply,
      deleteReply: review.internal.useCases.deleteReply,
      getReply: review.internal.useCases.getReply,
      retryPublish: review.internal.useCases.retryPublish,
      reconcileReplyPublication: review.internal.useCases.reconcileReplyPublication,
      getStaffRecentActivity: review.internal.useCases.getStaffRecentActivity,
      ...inbox.internal.useCases,
      getDashboardData: dashboard.publicApi.getDashboardData,
      getPortalAnalytics: dashboard.publicApi.getPortalAnalytics,
      getStaffDashboardData: dashboard.publicApi.getStaffDashboardData,
      getAttentionSignals: dashboard.publicApi.getAttentionSignals,
      getFleetOverview: dashboard.publicApi.getFleetOverview,
      ...goal.internal.useCases,
      ...badge.internal.useCases,
      ...leaderboard.internal.useCases,
    },
    storage: portal.internal.storage,
    portalRepo: portal.internal.repos.portalRepo,
    portalLinkRepo: portal.internal.repos.portalLinkRepo,
    reviewRepo: review.internal.repos.reviewRepo,
    replyRepo: review.internal.repos.replyRepo,
    badgePublicApi: badge.publicApi,
    leaderboardPublicApi: leaderboard.publicApi,
    reviewQueue: review.internal.repos.queue,
    replyQueue: review.internal.repos.replyQueue,
    googleReviewApi: integration.internal.googleReviewApi,
    staffPublicApi: staff.publicApi,
    inboxRepo: inbox.internal.repos.inboxRepo,
    inboxNoteRepo: inbox.internal.repos.inboxNoteRepo,
    goalRepo: goal.internal.repos.goalRepo,
    metricPublicApi: metricApi.publicApi,
    activityPublicApi: activity.publicApi,
    activityRepo: activity.internal.repos.activityRepo,
    notificationPublicApi: notification.publicApi,
    identityPort,
    // BQC-2.7: least-privilege policy administration operations.
    policyAdmin: identity.internal.policyAdmin,
    portalPublicApi: portal.publicApi,
    notificationRepo: notification.internal.repos.notificationRepo,
    notificationEmailRepo: notification.internal.repos.emailRepo,
    notificationPrefRepo: notification.internal.repos.prefRepo,
    // BQC-2.2: version-gated strong read of persisted policy state.
    // Workers await this before starting; side-effect paths use it for
    // fresh reads (BQC-2.5). Owned by the identity build (readiness).
    refreshPolicyStore: identity.internal.refreshPolicyStore,
    // BQR-2.2/2.4: worker calls this before optional durable dispatch start.
    // Owned by the inbox build (runtime contribution).
    registerOutboxConsumers: inbox.internal.registerOutboxConsumers,
  } as const
}

export type Container = ReturnType<typeof createContainer>

let _container: Container | undefined

/** Get or create the singleton container. */
export function getContainer(): Container {
  if (!_container) {
    _container = createContainer()
  }
  return _container
}

// Cold-boot race fix: the policy singletons (interactive + delayed) are
// installed inside createContainer, but policy checks can run BEFORE any
// getContainer() call in a fresh process (e.g. the first dashboard load
// after a dev-server restart — requireExecutionAllowed precedes the fn's
// own getContainer call and used to fail with "[EXECUTION POLICY] not
// initialized"). Registering getContainer as the lazy initializer means the
// first policy read builds the root on demand. Tests that reset the
// singletons and don't need the lazy path are unaffected — the hooks only
// fire while a policy is uninitialized.
registerExecutionPolicyInit(() => getContainer())
registerDelayedExecutionPolicyInit(() => getContainer())
