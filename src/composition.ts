// Composition root — wires the full dependency graph.
// This is the only place where the full container is built.
// Both server and worker build it and use it.
//
// Per architecture: "No DI framework, no auto-wiring, no decorators.
// Dependencies are passed as function arguments. The wiring is in composition.ts, visible."

import { getDb } from '#/shared/db'
import type { Database } from '#/shared/db'
import { getLogger } from '#/shared/observability/logger'
import { getRedis } from '#/shared/cache/redis'
import { createEventBus } from '#/shared/events/event-bus'
import type { EventBus } from '#/shared/events/event-bus'
import { createRedisCache } from '#/shared/cache/redis-cache'
import { createNoopCache } from '#/shared/cache/noop-cache'
import type { Cache } from '#/shared/cache/cache.port'
import { createRateLimiter } from '#/shared/rate-limit/middleware'
import type { RateLimiter } from '#/shared/rate-limit/middleware'
import { createJobQueue } from '#/shared/jobs/queue'
import { createJobRegistry } from '#/shared/jobs/registry'
import type { JobRegistry } from '#/shared/jobs/registry'
import { createBetterAuthIdentityAdapter } from '#/contexts/identity/infrastructure/adapters/auth-identity.adapter'
import type { IdentityPort } from '#/contexts/identity/application/ports/identity.port'
import {
  betterAuthOrganizationSchema,
  parseBetterAuthResponse,
} from '#/contexts/identity/infrastructure/adapters/better-auth-schemas'
import { buildIdentityContext } from '#/contexts/identity/build'
import { getAuth, setOnAcceptInvitation } from '#/shared/auth/auth'
import { sendInvitationEmail } from '#/shared/auth/emails'
import { headersFromContext } from '#/shared/auth/headers'
import { getEnv } from '#/shared/config/env'
import type { Env } from '#/shared/config/env'
import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Clock } from '#/shared/domain/clock'
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
import { buildBadgeContext } from '#/contexts/badge/build'
import { buildLeaderboardContext } from '#/contexts/leaderboard/build'
import { buildDashboardContext } from '#/contexts/dashboard/build'
import { createReviewStatsAdapter } from '#/contexts/dashboard/infrastructure/adapters/review-stats.adapter'
import { createMetricStatsAdapter } from '#/contexts/dashboard/infrastructure/adapters/metric-stats.adapter'
import { createPortalMetricsAdapter } from '#/contexts/dashboard/infrastructure/adapters/portal-metrics.adapter'
import { createAttentionSignalsAdapter } from '#/contexts/dashboard/infrastructure/adapters/attention-signals.adapter'
import { createStaffPortalResolverAdapter } from '#/contexts/dashboard/infrastructure/adapters/staff-portal-resolver.adapter'
import { buildGoalContext } from '#/contexts/goal/build'
import { buildActivityContext } from '#/contexts/activity/build'
import { buildNotificationContext } from '#/contexts/notification/build'
import { createStaffAssignmentRepository } from '#/contexts/staff/infrastructure/repositories/staff-assignment.repository'
import { createStaffAssignmentSystem } from '#/contexts/staff/application/use-cases/create-staff-assignment'
import { createIdentityMembershipAdapter } from '#/contexts/staff/infrastructure/adapters/identity-membership.adapter'
import { createGoogleReviewApiAdapter } from '#/contexts/integration/infrastructure/adapters/google-review-api.adapter'
import { handleGbpNotification } from '#/contexts/integration/application/use-cases'
import type { PropertyLookupPort } from '#/contexts/integration/application/ports/property-lookup.port'
import { createReviewLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/review-lookup.adapter'
import { createFeedbackLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/feedback-lookup.adapter'
import { createPropertyLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/property-lookup.adapter'
import { createReplyLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/reply-lookup.adapter'
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
  const jobRegistry: JobRegistry = createJobRegistry()
  return { cache, rateLimiter, jobQueue, jobRegistry }
}

// ── Identity infrastructure helpers ────────────────────────────────

function createOrg(name: string, slug: string, userId?: string): Promise<string> {
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
  /** Override the identity port (simulations use the in-memory identity fake). */
  identityPort?: IdentityPort
  /** Override the email sender (simulations capture emails instead of sending). */
  email?: typeof sendInvitationEmail
}) {
  const { enableJobs = false } = options ?? {}
  const db = options?.db ?? getDb()
  const logger = getLogger()
  const redis = options?.redis ?? getRedis()
  const eventBus = options?.eventBus ?? createEventBus()
  const clock = options?.clock ?? (() => new Date())
  const env = options?.env ?? getEnv()

  // Infrastructure
  const infra = buildInfrastructure({ redis, enableJobs, queue: options?.queue })

  // Identity port (adapter)
  const identityPort = options?.identityPort ?? createBetterAuthIdentityAdapter(db)

  // ── Context builds (dependency order) ──────────────────────────────
  const staffRepo = createStaffAssignmentRepository(db)
  const staff = buildStaffContext({
    repo: staffRepo,
    identityMembership: createIdentityMembershipAdapter(db),
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
    identityPort,
    events: eventBus,
    clock,
    signUp: identityPort.signUp,
    createOrg,
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
    deleteUser: identityPort.deleteUser,
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
    clock,
    linkResolver: portal.internal.repos.linkResolver,
    portalApi: portal.publicApi.portal,
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

  // Goal context — buildGoalContext creates its own repo and cancelGoalFn internally.
  // implements review context's port. Composition root wires them.
  const googleReviewApi = createGoogleReviewApiAdapter({
    connectionRepo: integration.internal.repos.connectionRepo,
    encryption: integration.internal.repos.encryptionPort,
    refreshToken: integration.internal.useCases.refreshGoogleToken,
    logger: getLogger(),
  })

  const review = buildReviewContext({
    db,
    events: eventBus,
    clock,
    staffPublicApi: staff.publicApi,
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

  const replyLookup = createReplyLookupAdapter({
    findInternalByReviewId: (id, orgId) =>
      review.internal.repos.replyRepo.findInternalByReviewId(id, orgId),
  })

  const inbox = buildInboxContext({
    db,
    events: eventBus,
    clock,
    staffPublicApi: staff.publicApi,
    reviewLookup,
    feedbackLookup,
    propertyLookup: inboxPropertyLookup,
    replyLookup,
    logger: getLogger(),
  })

  const metricApi = buildMetricContext({
    db,
    events: eventBus,
    clock,
    findGroupForPortal: async (orgId, pid) => {
      const group = await portal.publicApi.portalGroup.findGroupForPortal(orgId, pid)
      return group ? { portalGroupId: group.id } : null
    },
  })

  // Goal context — buildGoalContext creates its own repo and cancelGoalFn internally.
  const goal = buildGoalContext({
    db,
    metricApi: metricApi.publicApi,
    events: eventBus,
    clock,
    staffPublicApi: staff.publicApi,
    idGen: () => crypto.randomUUID(),
    getLogger,
    findGroupForPortal: async (orgId, pid) => {
      const group = await portal.publicApi.portalGroup.findGroupForPortal(orgId, pid)
      return group ? { portalGroupId: group.id } : null
    },
    portalGroupLookup: {
      findGroupIdsByPortalIds: (orgId, portalIds) =>
        portal.publicApi.portalGroup.findGroupIdsByPortalIds(orgId, portalIds),
    },
  })

  // ── Dashboard context (facade ports per ADR-0007) ────────────────
  // Dashboard never queries review/reply/metric tables directly.
  // Adapters encapsulate SQL; dashboard repo only composes.
  const reviewStats = createReviewStatsAdapter(db)
  const metricStats = createMetricStatsAdapter(db)
  const portalMetrics = createPortalMetricsAdapter(db)
  const attentionSignals = createAttentionSignalsAdapter(db, clock)

  const staffPortalResolver = createStaffPortalResolverAdapter(staff.publicApi)

  const dashboard = buildDashboardContext({
    reviewStats,
    metricStats,
    portalMetrics,
    attentionSignals,
    staffPortalResolver,
    clock,
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

  const badge = buildBadgeContext({
    db,
    events: eventBus,
    clock,
    metricApi: metricApi.publicApi,
  })

  const leaderboard = buildLeaderboardContext({
    db,
    events: eventBus,
    clock,
  })
  // Goal context — buildGoalContext creates its own repo and cancelGoalFn internally.
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
  //
  // Privileged SYSTEM write, not a user action: it bootstraps an
  // assignment for the invitee. We use createStaffAssignmentSystem (skips
  // can(), the membership gate, property-access scoping, and the
  // self-assignment guard BY DESIGN) instead of forging an AccountAdmin
  // AuthContext to satisfy createStaffAssignment's checks — deep-review §9
  // (AuthContext forgery). Reachable only here; tagged system-initiated
  // (no human actor in the audit trail).
  const createSystemStaffAssignment = createStaffAssignmentSystem({
    assignmentRepo: staffRepo,
    events: eventBus,
    idGen: () => crypto.randomUUID(),
    clock,
  })
  setOnAcceptInvitation(async ({ userId, organizationId, propertyIds }) => {
    const uid = toUserId(userId)
    const oid = toOrgId(organizationId)
    for (const pid of propertyIds) {
      try {
        await createSystemStaffAssignment(
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
    clock,
    cache: infra.cache,
    rateLimiter: infra.rateLimiter,
    jobQueue: infra.jobQueue,
    jobRegistry: infra.jobRegistry,
    useCases: {
      ...identity.internal.useCases,
      ...property.internal.useCases,
      ...staff.internal.useCases,
      ...team.internal.useCases,
      ...portal.internal.useCases,
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
    googleReviewApi,
    staffPublicApi: staff.publicApi,
    inboxRepo: inbox.internal.repos.inboxRepo,
    inboxNoteRepo: inbox.internal.repos.inboxNoteRepo,
    goalRepo: goal.internal.repos.goalRepo,
    metricPublicApi: metricApi.publicApi,
    activityPublicApi: activity.publicApi,
    activityRepo: activity.internal.repos.activityRepo,
    notificationPublicApi: notification.publicApi,
    identityPort,
    portalPublicApi: portal.publicApi,
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
