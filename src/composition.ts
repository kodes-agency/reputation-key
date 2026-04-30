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
import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { Redis } from 'ioredis'
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
  portalId,
  organizationId as toOrgId,
  userId as toUserId,
} from '#/shared/domain/ids'
import { randomUUID } from 'crypto'
import type { PropertyAccessProvider } from '#/shared/domain/property-access.port'
import { createPortalRepository } from '#/contexts/portal/infrastructure/repositories/portal.repository'
import { createPortalLinkRepository } from '#/contexts/portal/infrastructure/repositories/portal-link.repository'
import { createR2StorageAdapter } from '#/contexts/portal/infrastructure/adapters/r2-storage.adapter'
import { createPortal } from '#/contexts/portal/application/use-cases/create-portal'
import { updatePortal } from '#/contexts/portal/application/use-cases/update-portal'
import { getPortal } from '#/contexts/portal/application/use-cases/get-portal'
import { listPortals } from '#/contexts/portal/application/use-cases/list-portals'
import { softDeletePortal } from '#/contexts/portal/application/use-cases/soft-delete-portal'
import { createLinkCategory } from '#/contexts/portal/application/use-cases/create-link-category'
import { updateLinkCategory } from '#/contexts/portal/application/use-cases/update-link-category'
import { deleteLinkCategory } from '#/contexts/portal/application/use-cases/delete-link-category'
import { reorderCategories } from '#/contexts/portal/application/use-cases/reorder-categories'
import { createLink } from '#/contexts/portal/application/use-cases/create-link'
import { updateLink } from '#/contexts/portal/application/use-cases/update-link'
import { deleteLink } from '#/contexts/portal/application/use-cases/delete-link'
import { reorderLinks } from '#/contexts/portal/application/use-cases/reorder-links'
import { requestUploadUrl } from '#/contexts/portal/application/use-cases/request-upload-url'
import { finalizeUpload } from '#/contexts/portal/application/use-cases/finalize-upload'

// ── Infrastructure ─────────────────────────────────────────────────

function buildInfrastructure(options: { redis: Redis | undefined; enableJobs: boolean }) {
  const cache: Cache = options.redis ? createRedisCache(options.redis) : createNoopCache()
  const rateLimiter: RateLimiter = createRateLimiter(options.redis, {
    keyPrefix: 'ratelimit:public',
    maxRequests: 60,
    windowSeconds: 60,
  })
  const jobQueue: Queue | undefined = options.enableJobs ? createJobQueue('default') : undefined
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

// ── Property context ───────────────────────────────────────────────

function buildPropertyContext(deps: { db: Database; eventBus: EventBus }) {
  const propertyRepo = createPropertyRepository(deps.db)
  const idGen = () => propertyId(randomUUID())
  const clock = () => new Date()
  return { propertyRepo, idGen, clock }
}

// ── Team context ───────────────────────────────────────────────────

function buildTeamContext(deps: { db: Database; propertyRepo: ReturnType<typeof createPropertyRepository> }) {
  const teamRepo = createTeamRepository(deps.db)
  const teamIdGen = () => teamId(randomUUID())

  const propertyExists = {
    exists: async (
      orgId: Parameters<typeof deps.propertyRepo.findById>[0],
      pid: Parameters<typeof deps.propertyRepo.findById>[1],
    ) => {
      const p = await deps.propertyRepo.findById(orgId, pid)
      return p !== null
    },
  }

  return { teamRepo, teamIdGen, propertyExists }
}

// ── Staff context ──────────────────────────────────────────────────

function buildStaffContext(deps: { db: Database }) {
  const staffAssignmentRepo = createStaffAssignmentRepository(deps.db)
  const staffIdGen = () => staffAssignmentId(randomUUID())
  return { staffAssignmentRepo, staffIdGen }
}

// ── Portal context ─────────────────────────────────────────────────

function buildPortalContext(deps: { db: Database; propertyRepo: ReturnType<typeof createPropertyRepository> }) {
  const portalRepo = createPortalRepository(deps.db)
  const portalLinkRepo = createPortalLinkRepository(deps.db)
  const storage = createR2StorageAdapter()
  const portalIdGen = () => portalId(randomUUID())
  const linkIdGen = () => randomUUID()

  const portalPropertyExists = {
    exists: async (orgId: string, pid: string) => {
      const p = await deps.propertyRepo.findById(
        orgId as unknown as import('#/shared/domain/ids').OrganizationId,
        pid as unknown as import('#/shared/domain/ids').PropertyId,
      )
      return p !== null
    },
  }

  return { portalRepo, portalLinkRepo, storage, portalIdGen, linkIdGen, portalPropertyExists }
}

// ── Use cases ──────────────────────────────────────────────────────

function buildUseCases(deps: {
  identityPort: ReturnType<typeof buildIdentityContext>['identityPort']
  createOrg: ReturnType<typeof buildIdentityContext>['createOrg']
  setActiveOrg: ReturnType<typeof buildIdentityContext>['setActiveOrg']
  propertyRepo: ReturnType<typeof buildPropertyContext>['propertyRepo']
  eventBus: EventBus
  idGen: ReturnType<typeof buildPropertyContext>['idGen']
  clock: ReturnType<typeof buildPropertyContext>['clock']
  teamRepo: ReturnType<typeof buildTeamContext>['teamRepo']
  teamIdGen: ReturnType<typeof buildTeamContext>['teamIdGen']
  propertyExists: ReturnType<typeof buildTeamContext>['propertyExists']
  staffAssignmentRepo: ReturnType<typeof buildStaffContext>['staffAssignmentRepo']
  staffIdGen: ReturnType<typeof buildStaffContext>['staffIdGen']
  portalRepo: ReturnType<typeof buildPortalContext>['portalRepo']
  portalLinkRepo: ReturnType<typeof buildPortalContext>['portalLinkRepo']
  storage: ReturnType<typeof buildPortalContext>['storage']
  portalIdGen: ReturnType<typeof buildPortalContext>['portalIdGen']
  linkIdGen: ReturnType<typeof buildPortalContext>['linkIdGen']
  portalPropertyExists: ReturnType<typeof buildPortalContext>['portalPropertyExists']
}) {
  const propertyAccess: PropertyAccessProvider = {
    getAccessiblePropertyIds: async (orgId, uid, role) => {
      if (role === 'AccountAdmin') return null
      return deps.staffAssignmentRepo.getAccessiblePropertyIds(orgId, uid)
    },
  }

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
    // Property
    createProperty: createProperty({
      propertyRepo: deps.propertyRepo,
      events: deps.eventBus,
      idGen: deps.idGen,
      clock: deps.clock,
    }),
    updateProperty: updateProperty({ propertyRepo: deps.propertyRepo, events: deps.eventBus, clock: deps.clock }),
    listProperties: listProperties({ propertyRepo: deps.propertyRepo, propertyAccess }),
    getProperty: getProperty({ propertyRepo: deps.propertyRepo }),
    softDeleteProperty: softDeleteProperty({
      propertyRepo: deps.propertyRepo,
      events: deps.eventBus,
      clock: deps.clock,
    }),
    // Team
    createTeam: createTeam({
      teamRepo: deps.teamRepo,
      propertyExists: deps.propertyExists,
      events: deps.eventBus,
      idGen: deps.teamIdGen,
      clock: deps.clock,
    }),
    updateTeam: updateTeam({ teamRepo: deps.teamRepo, events: deps.eventBus, clock: deps.clock }),
    listTeams: listTeams({ teamRepo: deps.teamRepo, propertyAccess }),
    getTeam: getTeam({ teamRepo: deps.teamRepo, propertyAccess }),
    softDeleteTeam: softDeleteTeam({ teamRepo: deps.teamRepo, events: deps.eventBus, clock: deps.clock }),
    // Staff
    createStaffAssignment: createStaffAssignment({
      assignmentRepo: deps.staffAssignmentRepo,
      events: deps.eventBus,
      idGen: deps.staffIdGen,
      clock: deps.clock,
    }),
    removeStaffAssignment: removeStaffAssignment({
      assignmentRepo: deps.staffAssignmentRepo,
      events: deps.eventBus,
      clock: deps.clock,
    }),
    listStaffAssignments: listStaffAssignments({
      assignmentRepo: deps.staffAssignmentRepo,
    }),
    // Portal
    createPortal: createPortal({
      portalRepo: deps.portalRepo,
      propertyExists: deps.portalPropertyExists.exists,
      events: deps.eventBus,
      idGen: deps.portalIdGen,
      clock: deps.clock,
    }),
    updatePortal: updatePortal({ portalRepo: deps.portalRepo, events: deps.eventBus, clock: deps.clock }),
    getPortal: getPortal({ portalRepo: deps.portalRepo }),
    listPortals: listPortals({ portalRepo: deps.portalRepo }),
    softDeletePortal: softDeletePortal({ portalRepo: deps.portalRepo, events: deps.eventBus, clock: deps.clock }),
    createLinkCategory: createLinkCategory({
      portalRepo: deps.portalRepo,
      portalLinkRepo: deps.portalLinkRepo,
      events: deps.eventBus,
      idGen: deps.linkIdGen,
      clock: deps.clock,
    }),
    updateLinkCategory: updateLinkCategory({ portalLinkRepo: deps.portalLinkRepo, clock: deps.clock }),
    deleteLinkCategory: deleteLinkCategory({ portalLinkRepo: deps.portalLinkRepo }),
    reorderCategories: reorderCategories({ portalLinkRepo: deps.portalLinkRepo, events: deps.eventBus, clock: deps.clock }),
    createLink: createLink({
      portalLinkRepo: deps.portalLinkRepo,
      events: deps.eventBus,
      idGen: deps.linkIdGen,
      clock: deps.clock,
    }),
    updateLink: updateLink({ portalLinkRepo: deps.portalLinkRepo, clock: deps.clock }),
    deleteLink: deleteLink({ portalLinkRepo: deps.portalLinkRepo }),
    reorderLinks: reorderLinks({ portalLinkRepo: deps.portalLinkRepo, events: deps.eventBus, clock: deps.clock }),
    requestUploadUrl: requestUploadUrl({ portalRepo: deps.portalRepo, storage: deps.storage }),
    finalizeUpload: finalizeUpload({ portalRepo: deps.portalRepo, storage: deps.storage, clock: deps.clock }),
  } as const
}

// ── Main container ─────────────────────────────────────────────────

export function createContainer(options?: { enableJobs?: boolean }) {
  const { enableJobs = false } = options ?? {}
  const db = getDb()
  const logger = getLogger()
  const redis = getRedis()
  const eventBus = createEventBus()

  const infra = buildInfrastructure({ redis, enableJobs })
  const identity = buildIdentityContext()
  const property = buildPropertyContext({ db, eventBus })
  const team = buildTeamContext({ db, propertyRepo: property.propertyRepo })
  const staff = buildStaffContext({ db })
  const portal = buildPortalContext({ db, propertyRepo: property.propertyRepo })

  const useCases = buildUseCases({
    ...identity,
    ...property,
    ...team,
    ...staff,
    ...portal,
    eventBus,
  })

  // ── Wire invitation acceptance hook ────────────────────────────
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
    useCases,
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
