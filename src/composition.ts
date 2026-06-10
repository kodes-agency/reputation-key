// Composition root — wires the full dependency graph.
// This is the only place where the full container is built.
// Both server and worker build it and use it.
//
// Per architecture: "No DI framework, no auto-wiring, no decorators.
// Dependencies are passed as function arguments. The wiring is in composition.ts, visible."

import { getDb } from '#/shared/db'
import { getLogger } from '#/shared/observability/logger'
import { getRedis } from '#/shared/cache/redis'
import { createEventBus } from '#/shared/events/event-bus'
import { createRedisCache } from '#/shared/cache/redis-cache'
import { createNoopCache } from '#/shared/cache/noop-cache'
import type { Cache } from '#/shared/cache/cache.port'
import { createRateLimiter } from '#/shared/rate-limit/middleware'
import type { RateLimiter } from '#/shared/rate-limit/middleware'
import { createJobQueue } from '#/shared/jobs/queue'
import { createJobRegistry } from '#/shared/jobs/registry'
import type { JobRegistry } from '#/shared/jobs/registry'
import { createBetterAuthIdentityAdapter } from '#/contexts/identity/infrastructure/adapters/auth-identity.adapter'
import {
  betterAuthOrganizationSchema,
  parseBetterAuthResponse,
} from '#/contexts/identity/infrastructure/adapters/better-auth-schemas'
import { buildIdentityContext } from '#/contexts/identity/build'
import { getAuth, setOnAcceptInvitation } from '#/shared/auth/auth'
import { sendInvitationEmail } from '#/shared/auth/emails'
import { headersFromContext } from '#/shared/auth/headers'
import { getEnv } from '#/shared/config/env'
import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { buildPropertyContext } from '#/contexts/property/build'
import { createPropertyRepository } from '#/contexts/property/infrastructure/repositories/property.repository'
import { buildIntegrationContext } from '#/contexts/integration/build'
import { buildTeamContext } from '#/contexts/team/build'
import { buildStaffContext } from '#/contexts/staff/build'
import { buildPortalContext } from '#/contexts/portal/build'
import { buildGuestContext } from '#/contexts/guest/build'
import { buildReviewContext } from '#/contexts/review/build'
import { buildInboxContext } from '#/contexts/inbox/build'
import { buildMetricContext } from '#/contexts/metric/build'
import { buildDashboardContext } from '#/contexts/dashboard/build'
import { buildActivityContext } from '#/contexts/activity/build'
import { buildNotificationContext } from '#/contexts/notification/build'
import { createReviewStatsAdapter } from '#/contexts/dashboard/infrastructure/adapters/review-stats.adapter'
import { createMetricStatsAdapter } from '#/contexts/dashboard/infrastructure/adapters/metric-stats.adapter'
import { createPortalMetricsAdapter } from '#/contexts/dashboard/infrastructure/adapters/portal-metrics.adapter'
import { buildGoalContext } from '#/contexts/goal/build'
import { createGoalRepository as _createGoalRepo } from '#/contexts/goal/infrastructure/repositories/goal.repository'
import { cancelGoal as _cancelGoalFn } from '#/contexts/goal/application/use-cases/cancel-goal'
import { createStaffAssignmentRepository } from '#/contexts/staff/infrastructure/repositories/staff-assignment.repository'
import { createGoogleReviewApiAdapter } from '#/contexts/integration/infrastructure/adapters/google-review-api.adapter'
import { handleGbpNotification } from '#/contexts/integration/application/use-cases'
import type { PropertyLookupPort } from '#/contexts/integration/application/ports/property-lookup.port'
import { createReviewLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/review-lookup.adapter'
import { createFeedbackLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/feedback-lookup.adapter'
import { createPropertyLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/property-lookup.adapter'
import {
  propertyId,
  organizationId as toOrgId,
  userId as toUserId,
} from '#/shared/domain/ids'

// ── Infrastructure ─────────────────────────────────────────────────

function buildInfrastructure(options: { redis: Redis | undefined; enableJobs: boolean }) {
  const cache: Cache = options.redis ? createRedisCache(options.redis) : createNoopCache()
  const rateLimiter: RateLimiter = createRateLimiter(options.redis, {
    keyPrefix: 'ratelimit:public',
    maxRequests: 60,
    windowSeconds: 60,
  })
  // Create queue whenever Redis is available — the web server needs it to
  // enqueue jobs; the worker process also needs it for processing.
  const jobQueue: Queue | undefined = options.redis
    ? createJobQueue('default')
    : undefined
  const jobRegistry: JobRegistry = createJobRegistry()
  return { cache, rateLimiter, jobQueue, jobRegistry }
}

// ── Identity infrastructure helpers ────────────────────────────────

function createOrg(
  _headers: Headers,
  name: string,
  slug: string,
  userId?: string,
): Promise<string> {
  const auth = getAuth()
  return auth.api
    .createOrganization({
      body: { name, slug, userId },
    })
    .then((org) => {
      const parsed = parseBetterAuthResponse(
        betterAuthOrganizationSchema,
        org,
        'org_setup_failed',
        'Invalid organization response from auth provider',
      )
      return parsed.id
    })
}

async function setActiveOrg(headers: Headers, orgId: string): Promise<void> {
  const auth = getAuth()
  const logger = getLogger()
  try {
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

export function createContainer(options?: { enableJobs?: boolean }) {
  const { enableJobs = false } = options ?? {}
  const db = getDb()
  const logger = getLogger()
  const redis = getRedis()
  const eventBus = createEventBus()
  const clock = () => new Date()
  const env = getEnv()

  // Infrastructure
  const infra = buildInfrastructure({ redis, enableJobs })

  // Identity port (adapter)
  const identityPort = createBetterAuthIdentityAdapter()

  // ── Context builds (dependency order) ──────────────────────────────
  const staffRepo = createStaffAssignmentRepository(db)
  const staff = buildStaffContext({
    repo: staffRepo,
    events: eventBus,
    clock,
  })

  const identity = buildIdentityContext({
    identityPort,
    events: eventBus,
    clock,
    signUp: identityPort.signUp,
    createOrg,
    setActiveOrg,
    updateOrg: async (headers, data) => {
      const auth = getAuth()
      await auth.api.updateOrganization({ headers, body: { data } })
    },
    headers: headersFromContext,
    sendEmail: sendInvitationEmail,
    getOrganizationName: async (_ctx) => {
      const auth = getAuth()
      const headers = await headersFromContext()
      const org = await auth.api.getFullOrganization({ headers })
      return org?.name ?? 'Unknown Organization'
    },
    baseUrl: env.BETTER_AUTH_URL,
  })

  const property = buildPropertyContext({
    repo: createPropertyRepository(db),
    events: eventBus,
    clock,
    staffPublicApi: staff.publicApi,
  })

  const team = buildTeamContext({
    db,
    events: eventBus,
    clock,
    propertyApi: property.publicApi,
    staffApi: staff.publicApi,
  })

  const portal = buildPortalContext({
    db,
    events: eventBus,
    clock,
    propertyApi: property.publicApi,
    baseUrl: env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  })

  const guest = buildGuestContext({
    db,
    events: eventBus,
    clock,
    linkResolver: portal.linkResolver,
    portalApi: portal.publicApi,
    logger,
  })

  // ── Property lookup port for integration context (webhook) ────────
  // The GBP webhook needs to find properties by gbpPlaceId without an
  // organizationId (push-based from Google).
  // Per architecture fix (M4): delegates to Property context's public API
  // instead of querying the properties table directly.
  const propertyLookup: PropertyLookupPort = {
    findByGbpPlaceId: property.publicApi.findByGbpPlaceId,
  }

  const integration = buildIntegrationContext({
    db,
    events: eventBus,
    clock,
    jobQueue: infra.jobQueue,
    propertyLookup,
    propertyApi: property.publicApi,
    logger: getLogger(),
  })

  // ── Review context (cross-context wiring) ──────────────────────────
  // The GoogleReviewApiAdapter lives in integration/infrastructure but
  // implements review context's port. Composition root wires them.
  const googleReviewApi = createGoogleReviewApiAdapter({
    connectionRepo: integration.internal.repos.connectionRepo,
    encryption: integration.internal.repos.encryptionPort,
    refreshToken: integration.internal.useCases.refreshGoogleToken,
  })

  const review = buildReviewContext({
    db,
    events: eventBus,
    clock,
    googleReviewApi,
    jobQueue: infra.jobQueue,
    logger: getLogger(),
  })

  // ── Inbox lookup ports (cross-context wiring) ─────────────────────
  // Per architecture: inbox context defines ports, composition root wires
  // them by delegating to review/guest/property context APIs via adapters.
  // Adapters live in inbox/infrastructure/adapters/ — cross-context SQL is
  // encapsulated there, not in the composition root or inbox repository.
  const reviewLookup = createReviewLookupAdapter({
    findReviewById: (id, orgId) => review.internal.repos.reviewRepo.findById(id, orgId),
    findReviewsByIds: (ids, orgId) =>
      review.internal.repos.reviewRepo.findByIds(ids, orgId),
  })

  const feedbackLookup = createFeedbackLookupAdapter({
    findFeedbackById: (id, orgId) =>
      guest.internal.repos.guestRepo.findFeedbackById(id, orgId),
    findRatingById: (id, orgId) =>
      guest.internal.repos.guestRepo.findRatingById(id, orgId),
  })

  const inboxPropertyLookup = createPropertyLookupAdapter({
    getPropertyName: (orgId, pid) => property.publicApi.getPropertyName(orgId, pid),
    getPropertyNames: (orgId, pids) => property.publicApi.getPropertyNames(orgId, pids),
  })

  const inbox = buildInboxContext({
    db,
    events: eventBus,
    redis,
    clock,
    staffPublicApi: staff.publicApi,
    reviewLookup,
    feedbackLookup,
    propertyLookup: inboxPropertyLookup,
    logger: getLogger(),
  })

  const metricApi = buildMetricContext({
    db,
    events: eventBus,
    clock,
  })

  // Goal context needs a cancelGoalFn for event handlers.
  // Create the goal repo early so we can wire cancelGoal independently
  // (avoids circular ref with buildGoalContext's return value).
  const goalRepoEarly = _createGoalRepo(db)
  const goalCancelFn = _cancelGoalFn({ goalRepo: goalRepoEarly, clock })

  const goal = buildGoalContext({
    db,
    metricApi: metricApi.publicApi,
    events: eventBus,
    clock,
    idGen: () => crypto.randomUUID(),
    cancelGoalFn: goalCancelFn,
    getLogger,
    findGroupForPortal: async (orgId, pid) => {
      const group = await portal.portalGroupPublicApi.findGroupForPortal(orgId, pid)
      return group ? { portalGroupId: group.id } : null
    },
  })

  // ── Dashboard context (facade ports per ADR-0007) ────────────────
  // Dashboard never queries review/reply/metric tables directly.
  // Adapters encapsulate SQL; dashboard repo only composes.
  const reviewStats = createReviewStatsAdapter(db)
  const metricStats = createMetricStatsAdapter(db)
  const portalMetrics = createPortalMetricsAdapter(db)

  const staffPortalResolver: import('#/contexts/dashboard/application/ports/staff-portal-resolver.port').StaffPortalResolverPort =
    async (input, ctx) => {
      return staff.publicApi.getAssignedPortals(input, ctx)
    }

  const dashboard = buildDashboardContext({
    reviewStats,
    metricStats,
    portalMetrics,
    staffPortalResolver,
  })

  // ── Activity context ────────────────────────────────────────────
  const activity = buildActivityContext({
    db,
    events: eventBus,
    staffPublicApi: staff.publicApi,
    queue: infra.jobQueue,
    clock,
    logger,
  })

  // ── Notification context ────────────────────────────────────────
  const notification = buildNotificationContext({
    db,
    events: eventBus,
    queue: infra.jobQueue,
    clock,
    logger,
  })

  // ── Wire invitation acceptance hook ────────────────────────────
  // The hook creates staff assignments when a member accepts an invite.
  // This is the only cross-context dependency: identity acceptance
  // triggers staff creation. Identity context does NOT import staff.
  setOnAcceptInvitation(async ({ userId, organizationId, propertyIds }) => {
    const uid = toUserId(userId)
    const oid = toOrgId(organizationId)
    for (const pid of propertyIds) {
      try {
        await staff.internal.useCases.createStaffAssignment(
          {
            userId: uid,
            propertyId: propertyId(pid),
          },
          { userId: uid, organizationId: oid, role: 'AccountAdmin' },
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
    cache: infra.cache,
    rateLimiter: infra.rateLimiter,
    jobQueue: infra.jobQueue,
    jobRegistry: infra.jobRegistry,
    useCases: {
      ...identity.internal.useCases,
      ...property.internal.useCases,
      ...staff.internal.useCases,
      ...team.internal.useCases,
      ...portal.useCases,
      ...guest.internal.useCases,
      ...integration.internal.useCases,
      handleGbpNotification: handleGbpNotification({
        propertyLookup,
        reviewQueue: review.internal.repos.queue,
        logger: getLogger(),
      }),
      syncReviews: review.internal.useCases.syncReviews,
      draftReply: review.internal.useCases.draftReply,
      submitReply: review.internal.useCases.submitReply,
      approveReply: review.internal.useCases.approveReply,
      rejectReply: review.internal.useCases.rejectReply,
      deleteReply: review.internal.useCases.deleteReply,
      getReply: review.internal.useCases.getReply,
      retryPublish: review.internal.useCases.retryPublish,
      ...inbox.internal.useCases,
      getDashboardData: dashboard.publicApi.getDashboardData,
      getPortalAnalytics: dashboard.publicApi.getPortalAnalytics,
      getStaffDashboardData: dashboard.publicApi.getStaffDashboardData,
      ...goal.useCases,
    },
    storage: portal.storage,
    portalRepo: portal.portalRepo,
    portalLinkRepo: portal.portalLinkRepo,
    reviewRepo: review.internal.repos.reviewRepo,
    replyRepo: review.internal.repos.replyRepo,
    reviewQueue: review.internal.repos.queue,
    replyQueue: review.internal.repos.replyQueue,
    googleReviewApi,
    inboxRepo: inbox.internal.repos.inboxRepo,
    inboxNoteRepo: inbox.internal.repos.inboxNoteRepo,
    unreadCounter: inbox.internal.repos.newCounter,
    goalRepo: goal.goalRepo,
    metricPublicApi: metricApi.publicApi,
    activityPublicApi: activity.publicApi,
    activityRepo: activity.internal.repos.activityRepo,
    notificationPublicApi: notification.publicApi,
    notificationRepo: notification.internal.repos.notificationRepo,
    notificationEmailRepo: notification.internal.repos.emailRepo,
    notificationPrefRepo: notification.internal.repos.prefRepo,
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
