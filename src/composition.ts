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
import { inviteMember } from '#/contexts/identity/application/use-cases/invite-member'
import { updateMemberRole } from '#/contexts/identity/application/use-cases/update-member-role'
import { removeMember } from '#/contexts/identity/application/use-cases/remove-member'
import { listInvitations } from '#/contexts/identity/application/use-cases/list-invitations'
import { resendInvitation } from '#/contexts/identity/application/use-cases/resend-invitation'
import { registerUserAndOrg } from '#/contexts/identity/application/use-cases/register-user-and-org'
import { registerUser } from '#/contexts/identity/application/use-cases/register-user'
import { getAuth, setOnAcceptInvitation } from '#/shared/auth/auth'
import { sendInvitationEmail } from '#/shared/auth/emails'
import { headersFromContext } from '#/shared/auth/headers'
import { getEnv } from '#/shared/config/env'
import type { Queue } from 'bullmq'
import type { EventBus } from '#/shared/events/event-bus'
import type { Redis } from 'ioredis'
import { buildPropertyContext } from '#/contexts/property/build'
import { createPropertyRepository } from '#/contexts/property/infrastructure/repositories/property.repository'
import { buildTeamContext } from '#/contexts/team/build'
import { buildStaffContext } from '#/contexts/staff/build'
import { buildPortalContext } from '#/contexts/portal/build'
import { createStaffAssignmentRepository } from '#/contexts/staff/infrastructure/repositories/staff-assignment.repository'
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
  const jobQueue: Queue | undefined = options.enableJobs
    ? createJobQueue('default')
    : undefined
  const jobRegistry: JobRegistry = createJobRegistry()
  return { cache, rateLimiter, jobQueue, jobRegistry }
}

// ── Identity context ───────────────────────────────────────────────

function buildIdentityContext() {
  const identityPort = createAuthIdentityAdapter()

  const createOrg = async (
    _headers: Headers,
    name: string,
    slug: string,
    userId?: string,
  ): Promise<string> => {
    const auth = getAuth()
    const org = await auth.api.createOrganization({
      body: { name, slug, userId },
    })
    const parsed = parseBetterAuthResponse(
      betterAuthOrganizationSchema,
      org,
      'org_setup_failed',
      'Invalid organization response from auth provider',
    )
    return parsed.id
  }

  const setActiveOrg = async (headers: Headers, orgId: string): Promise<void> => {
    const auth = getAuth()
    try {
      await auth.api.setActiveOrganization({
        headers,
        body: { organizationId: orgId },
      })
    } catch {
      // If headers don't carry a valid session (e.g., during registration
      // where cookies aren't yet available), this is non-fatal — the user
      // will set their active org on first login.
    }
  }

  return { identityPort, createOrg, setActiveOrg }
}

// ── Use cases ──────────────────────────────────────────────────────

function buildUseCases(deps: {
  identityPort: ReturnType<typeof buildIdentityContext>['identityPort']
  createOrg: ReturnType<typeof buildIdentityContext>['createOrg']
  setActiveOrg: ReturnType<typeof buildIdentityContext>['setActiveOrg']
  eventBus: EventBus
  clock: () => Date
}) {
  return {
    // Identity
    inviteMember: inviteMember({
      identity: deps.identityPort,
      events: deps.eventBus,
      clock: deps.clock,
    }),
    updateMemberRole: updateMemberRole({
      identity: deps.identityPort,
      events: deps.eventBus,
      clock: deps.clock,
    }),
    removeMember: removeMember({
      identity: deps.identityPort,
      events: deps.eventBus,
      clock: deps.clock,
    }),
    listInvitations: listInvitations({ identity: deps.identityPort }),
    resendInvitation: resendInvitation({
      identity: deps.identityPort,
      sendEmail: sendInvitationEmail,
      getOrganizationName: async (_ctx) => {
        const auth = getAuth()
        const headers = headersFromContext()
        const org = await auth.api.getFullOrganization({ headers })
        return org?.name ?? 'Unknown Organization'
      },
      baseUrl: getEnv().BETTER_AUTH_URL,
    }),
    registerUserAndOrg: registerUserAndOrg({
      events: deps.eventBus,
      signUp: deps.identityPort.signUp,
      createOrg: deps.createOrg,
      setActiveOrg: deps.setActiveOrg,
      headers: headersFromContext,
      clock: deps.clock,
    }),
    registerUser: registerUser({ identity: deps.identityPort }),
  } as const
}

// ── Main container ─────────────────────────────────────────────────

export function createContainer(options?: { enableJobs?: boolean }) {
  const { enableJobs = false } = options ?? {}
  const db = getDb()
  const logger = getLogger()
  const redis = getRedis()
  const eventBus = createEventBus()
  const clock = () => new Date()

  const infra = buildInfrastructure({ redis, enableJobs })
  const identity = buildIdentityContext()
  const propertyRepo = createPropertyRepository(db)
  const staff = buildStaffContext({
    repo: createStaffAssignmentRepository(db),
    events: eventBus,
    clock,
  })
  const property = buildPropertyContext({
    repo: propertyRepo,
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
  })

  const useCases = buildUseCases({
    ...identity,
    eventBus,
    clock,
  })

  // ── Wire invitation acceptance hook ────────────────────────────
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
      ...useCases,
      ...property.useCases,
      ...staff.useCases,
      ...team.useCases,
      ...portal.useCases,
    },
    storage: portal.storage,
    portalRepo: portal.portalRepo,
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
