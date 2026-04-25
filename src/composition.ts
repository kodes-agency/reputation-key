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
import { registerUser } from '#/contexts/identity/application/use-cases/register-user'
import { getAuth } from '#/shared/auth/auth'
import { headersFromContext } from '#/shared/auth/headers'
import type { Queue } from 'bullmq'
import { createPropertyRepository } from '#/contexts/property/infrastructure/repositories/property.repository'
import { createProperty } from '#/contexts/property/application/use-cases/create-property'
import { updateProperty } from '#/contexts/property/application/use-cases/update-property'
import { listProperties } from '#/contexts/property/application/use-cases/list-properties'
import { getProperty } from '#/contexts/property/application/use-cases/get-property'
import { softDeleteProperty } from '#/contexts/property/application/use-cases/soft-delete-property'
import { createTeamRepository } from '#/contexts/team/infrastructure/repositories/team.repository'
import { createTeam } from '#/contexts/team/application/use-cases/create-team'
import { updateTeam } from '#/contexts/team/application/use-cases/update-team'
import { listTeams } from '#/contexts/team/application/use-cases/list-teams'
import { getTeam } from '#/contexts/team/application/use-cases/get-team'
import { softDeleteTeam } from '#/contexts/team/application/use-cases/soft-delete-team'
import { createStaffAssignmentRepository } from '#/contexts/staff/infrastructure/repositories/staff-assignment.repository'
import { createStaffAssignment } from '#/contexts/staff/application/use-cases/create-staff-assignment'
import { removeStaffAssignment } from '#/contexts/staff/application/use-cases/remove-staff-assignment'
import { listStaffAssignments } from '#/contexts/staff/application/use-cases/list-staff-assignments'
import { propertyId, teamId, staffAssignmentId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'
import type { PropertyAccessProvider } from '#/shared/domain/property-access.port'

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

  // Helper: create org via better-auth using the server-side userId field.
  // Uses userId instead of session headers so it works during registration
  // (when the new user's session cookies aren't available yet).
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
    return (org as unknown as { id: string }).id
  }

  // Helper: set active org via better-auth.
  // Falls back to setting via headers (works after registration when
  // the sign-up response has set cookies on the incoming request).
  const setActiveOrg = async (headers: Headers, orgId: string): Promise<void> => {
    const auth = getAuth()
    try {
      await auth.api.setActiveOrganization({ headers, body: { organizationId: orgId } })
    } catch {
      // If headers don't carry a valid session (e.g., during registration
      // where cookies aren't yet available), this is non-fatal — the user
      // will set their active org on first login.
    }
  }

  // ── Property context ────────────────────────────────────────────
  const propertyRepo = createPropertyRepository(db)
  const idGen = () => propertyId(randomUUID())
  const clock = () => new Date()

  // ── Team context ────────────────────────────────────────────────
  const teamRepo = createTeamRepository(db)
  const teamIdGen = () => teamId(randomUUID())

  // Property existence port for team context (boundary-safe)
  const propertyExists = {
    exists: async (
      orgId: Parameters<typeof propertyRepo.findById>[0],
      pid: Parameters<typeof propertyRepo.findById>[1],
    ) => {
      const p = await propertyRepo.findById(orgId, pid)
      return p !== null
    },
  }

  // ── Staff context ──────────────────────────────────────────────
  const staffAssignmentRepo = createStaffAssignmentRepository(db)
  const staffIdGen = () => staffAssignmentId(randomUUID())

  // Property access provider: AccountAdmin sees all, others see assigned only
  // Implements the shared PropertyAccessProvider port used by property and team contexts
  const propertyAccess: PropertyAccessProvider = {
    getAccessiblePropertyIds: async (orgId, uid, role) => {
      if (role === 'AccountAdmin') return null
      return staffAssignmentRepo.getAccessiblePropertyIds(orgId, uid)
    },
  }

  const useCases = {
    // Identity
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
    registerUser: registerUser({ identity: identityPort }),
    // Property
    createProperty: createProperty({ propertyRepo, events: eventBus, idGen, clock }),
    updateProperty: updateProperty({ propertyRepo, events: eventBus, clock }),
    listProperties: listProperties({ propertyRepo, propertyAccess }),
    getProperty: getProperty({ propertyRepo }),
    softDeleteProperty: softDeleteProperty({ propertyRepo, events: eventBus, clock }),
    // Team
    createTeam: createTeam({
      teamRepo,
      propertyExists,
      events: eventBus,
      idGen: teamIdGen,
      clock,
    }),
    updateTeam: updateTeam({ teamRepo, events: eventBus, clock }),
    listTeams: listTeams({ teamRepo, propertyAccess }),
    getTeam: getTeam({ teamRepo, propertyAccess }),
    softDeleteTeam: softDeleteTeam({ teamRepo, events: eventBus, clock }),
    // Staff
    createStaffAssignment: createStaffAssignment({
      assignmentRepo: staffAssignmentRepo,
      events: eventBus,
      idGen: staffIdGen,
      clock,
    }),
    removeStaffAssignment: removeStaffAssignment({
      assignmentRepo: staffAssignmentRepo,
      events: eventBus,
      clock,
    }),
    listStaffAssignments: listStaffAssignments({ assignmentRepo: staffAssignmentRepo }),
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
