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
import {
  propertyId,
  teamId,
  staffAssignmentId,
  organizationId as toOrgId,
  userId as toUserId,
} from '#/shared/domain/ids'
import { randomUUID } from 'crypto'
import type { PropertyAccessProvider } from '#/shared/domain/property-access.port'

export function createContainer(options?: { enableJobs?: boolean }) {
  const { enableJobs = false } = options ?? {}
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
  // Only create job infrastructure in the worker process
  const jobQueue: Queue | undefined = enableJobs ? createJobQueue('default') : undefined
  const jobRegistry: JobRegistry = enableJobs ? createJobRegistry() : createJobRegistry()

  // ── Identity context ─────────────────────────────────────────────
  const identityPort = createAuthIdentityAdapter()

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
    const parsed = parseBetterAuthResponse(
      betterAuthOrganizationSchema,
      org,
      'org_setup_failed',
      'Invalid organization response from auth provider',
    )
    return parsed.id
  }

  // Helper: set active org via better-auth.
  // Falls back to setting via headers (works after registration when
  // the sign-up response has set cookies on the incoming request).
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
    inviteMember: inviteMember({
      identity: identityPort,
      events: eventBus,
      clock,
    }),
    updateMemberRole: updateMemberRole({
      identity: identityPort,
      events: eventBus,
      clock,
    }),
    removeMember: removeMember({
      identity: identityPort,
      events: eventBus,
      clock,
    }),
    listInvitations: listInvitations({ identity: identityPort }),
    resendInvitation: resendInvitation({
      identity: identityPort,
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
      events: eventBus,
      signUp: identityPort.signUp,
      createOrg,
      setActiveOrg,
      headers: headersFromContext,
      clock,
    }),
    registerUser: registerUser({ identity: identityPort }),
    // Property
    createProperty: createProperty({
      propertyRepo,
      events: eventBus,
      idGen,
      clock,
    }),
    updateProperty: updateProperty({ propertyRepo, events: eventBus, clock }),
    listProperties: listProperties({ propertyRepo, propertyAccess }),
    getProperty: getProperty({ propertyRepo }),
    softDeleteProperty: softDeleteProperty({
      propertyRepo,
      events: eventBus,
      clock,
    }),
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
    listStaffAssignments: listStaffAssignments({
      assignmentRepo: staffAssignmentRepo,
    }),
  } as const

  // ── Wire invitation acceptance hook ────────────────────────────
  // When a member accepts an invitation, auto-create staff assignments
  // for the properties specified in the invitation's propertyIds field.
  setOnAcceptInvitation(async ({ userId, organizationId, propertyIds }) => {
    const uid = toUserId(userId)
    const oid = toOrgId(organizationId)
    for (const pid of propertyIds) {
      try {
        await useCases.createStaffAssignment(
          {
            userId: uid,
            propertyId: propertyId(pid),
          },
          { userId: uid, organizationId: oid, role: 'AccountAdmin' },
        )
      } catch {
        // Assignment may already exist or property may not exist — non-fatal
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
