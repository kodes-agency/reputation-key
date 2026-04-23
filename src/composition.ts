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
import { inviteMember } from '#/contexts/identity/application/use-cases/invite-member'
import { updateMemberRole } from '#/contexts/identity/application/use-cases/update-member-role'
import { removeMember } from '#/contexts/identity/application/use-cases/remove-member'
import { listInvitations } from '#/contexts/identity/application/use-cases/list-invitations'
import { registerUserAndOrg } from '#/contexts/identity/application/use-cases/register-user-and-org'
import { getAuth } from '#/shared/auth/auth'
import { headersFromContext } from '#/shared/auth/headers'
import type { Queue } from 'bullmq'

export function createContainer() {
  const db = getDb()
  const logger = getLogger()
  const redis = getRedis()
  const eventBus = createEventBus()

  // ── Infrastructure ──────────────────────────────────────────────
  const cache: Cache = redis ? createRedisCache(redis) : createNoopCache()
  const rateLimiter: RateLimiter = createRateLimiter(redis, {
    keyPrefix: 'ratelimit:public',
    maxRequests: 60,
    windowSeconds: 60,
  })
  const jobQueue: Queue | undefined = createJobQueue('default')
  const jobRegistry: JobRegistry = createJobRegistry()

  // ── Identity context ─────────────────────────────────────────────
  const identityPort = createAuthIdentityAdapter()

  // Helper: sign up a user via better-auth, returns user ID
  const signUpUser = async (
    name: string,
    email: string,
    password: string,
  ): Promise<string> => {
    const auth = getAuth()
    const result = await auth.api.signUpEmail({
      body: { name, email, password },
    })
    const user = result as unknown as { user?: { id?: string } }
    return user?.user?.id ?? ''
  }

  // Helper: create org via better-auth, returns org ID
  const createOrg = async (
    headers: Headers,
    name: string,
    slug: string,
  ): Promise<string> => {
    const auth = getAuth()
    const org = await auth.api.createOrganization({
      headers,
      body: { name, slug },
    })
    return (org as unknown as { id: string }).id
  }

  // Helper: set active org via better-auth
  const setActiveOrg = async (headers: Headers, orgId: string): Promise<void> => {
    const auth = getAuth()
    await auth.api.setActiveOrganization({ headers, body: { organizationId: orgId } })
  }

  const useCases = {
    inviteMember: inviteMember({ identity: identityPort, events: eventBus }),
    updateMemberRole: updateMemberRole({ identity: identityPort, events: eventBus }),
    removeMember: removeMember({ identity: identityPort, events: eventBus }),
    listInvitations: listInvitations({ identity: identityPort }),
    registerUserAndOrg: registerUserAndOrg({
      events: eventBus,
      signUp: signUpUser,
      createOrg,
      setActiveOrg,
      headers: headersFromContext,
    }),
  } as const

  return {
    db,
    logger,
    redis,
    eventBus,
    cache,
    rateLimiter,
    jobQueue,
    jobRegistry,
    useCases,
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
