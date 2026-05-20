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
import { createAuthIdentityAdapter } from '#/contexts/identity/infrastructure/adapters/auth-identity.adapter'
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
import { createStaffAssignmentRepository } from '#/contexts/staff/infrastructure/repositories/staff-assignment.repository'
import { createGoogleReviewApiAdapter } from '#/contexts/integration/infrastructure/adapters/google-review-api.adapter'
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
  const identityPort = createAuthIdentityAdapter()

  // ── Context builds (dependency order) ──────────────────────────────
  const staff = buildStaffContext({
    repo: createStaffAssignmentRepository(db),
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
      const headers = headersFromContext()
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
  })

  const integration = buildIntegrationContext({
    db,
    events: eventBus,
    clock,
    jobQueue: infra.jobQueue,
  })

  // ── Review context (cross-context wiring) ──────────────────────────
  // The GoogleReviewApiAdapter lives in integration/infrastructure but
  // implements review context's port. Composition root wires them.
  const googleReviewApi = createGoogleReviewApiAdapter({
    connectionRepo: integration.connectionRepo,
    encryption: integration.encryptionPort,
    refreshToken: integration.refreshGoogleTokenUseCase,
  })

  const review = buildReviewContext({
    db,
    events: eventBus,
    clock,
    googleReviewApi,
    jobQueue: infra.jobQueue,
  })

  const inbox = buildInboxContext({
    db,
    events: eventBus,
    redis,
    clock,
    staffPublicApi: staff.publicApi,
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
        await staff.useCases.createStaffAssignment(
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
      ...identity.useCases,
      ...property.useCases,
      ...staff.useCases,
      ...team.useCases,
      ...portal.useCases,
      ...guest.useCases,
      ...integration.useCases,
      syncReviews: review.syncReviews,
      ...inbox.useCases,
    },
    storage: portal.storage,
    portalRepo: portal.portalRepo,
    portalLinkRepo: portal.portalLinkRepo,
    reviewRepo: review.reviewRepo,
    replyRepo: review.replyRepo,
    reviewQueue: review.queue,
    googleReviewApi,
    inboxRepo: inbox.inboxRepo,
    inboxNoteRepo: inbox.inboxNoteRepo,
    unreadCounter: inbox.unreadCounter,
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
