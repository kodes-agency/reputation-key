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
import { initPersistedCapabilityPolicyStore } from '#/contexts/identity/infrastructure/policy-store-init'
import { createPolicyAdminOps } from '#/contexts/identity/application/use-cases/policy-admin'
import {
  createPolicyDiagnostic,
  createRegionDiagnostic,
} from '#/shared/auth/policy-diagnostic'
import {
  isCoreCapability,
  isBlockedCapability,
  listAllCapabilities,
  type Capability,
} from '#/shared/auth/beta-capabilities'
import { EXECUTION_POLICY_VERSION } from '#/shared/auth/execution-policy'
import { registerExecutionPolicyInit } from '#/shared/auth/execution-policy'
import { registerDelayedExecutionPolicyInit } from '#/shared/auth/system-execution-policy'
import {
  setOrganizationPolicy,
  setPropertyPolicy,
  addOrganizationCapability,
  removeOrganizationCapability,
  isOrgMember,
  getMemberRole,
  loadOrgPolicyState,
} from '#/contexts/identity/infrastructure/repositories/policy-state.repository'
import {
  grantPropertyAccess,
  revokePropertyAccess,
  hasActiveGrant,
  listActiveGrantsForOrg,
} from '#/contexts/identity/infrastructure/repositories/property-access-grant.repository'
import { writePolicyDecision } from '#/contexts/identity/infrastructure/repositories/policy-decision-audit.repository'
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
import { createFeedbackLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/feedback-lookup.adapter'
import { createPropertyLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/property-lookup.adapter'
import { createReplyLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/reply-lookup.adapter'
import { createReviewSourceLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/review-source-lookup.adapter'
import { registerInboxConsumers } from '#/contexts/inbox/infrastructure/outbox-consumers'
import {
  inboxItemId,
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
  /** Database + env for the persisted capability policy store (BQC-2.2). */
  db: Database
  env: Env
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
  // BQC-2.2: install the composite capability policy store — env global
  // posture (kill switch / e2e overrides unchanged) + persisted tenant state
  // (allowlist/suspension from the 0014 policy tables). The env seed unions
  // in, so behavior is identical until DB policy rows exist; revocation and
  // suspension take effect within POLICY_REFRESH_INTERVAL_MS.
  const policyStore = initPersistedCapabilityPolicyStore({
    db: options.db,
    env: options.env,
  })
  return { cache, rateLimiter, jobQueue, backgroundQueue, jobRegistry, policyStore }
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

// ── Outbox consumer registration (BQR-2.2) ─────────────────────────
// Kept outside createContainer so wiring stays a single assignment inside
// the composition root (complexity budget) while still capturing deps.

function createOutboxConsumerRegistrar(deps: {
  commandStore: import('#/contexts/inbox/application/ports/inbox-command-store.port').InboxCommandStore
  reviewLookup: import('#/contexts/inbox/application/ports/review-lookup.port').ReviewLookupPort
  reviewSourceLookup: import('#/contexts/inbox/application/ports/review-source-lookup.port').ReviewSourceLookupPort
  inboxRepo: import('#/contexts/inbox/application/ports/inbox.repository').InboxRepository
  idGen: () => import('#/shared/domain/ids').InboxItemId
  clock: Clock
}): () => void {
  return () => {
    registerInboxConsumers(deps)
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
    db,
    env,
  })

  // Identity port (adapter)
  const identityPort = options?.identityPort ?? createBetterAuthIdentityAdapter(db)

  // BQC-4.2: the ONE routing decision model — shared by the review context
  // (enqueue envelope stamping) and the BQC-4.4 operator region diagnostic.
  const processingRouter = createProcessingRouter({
    loadPropertyRouting: createPropertyRoutingLoader({ db }),
    cell: env.PROCESSING_CELL,
  })

  // BQC-2.7: policy administration operations (least-privilege, audited).
  // Identity-owned persistence bound here — application layer stays
  // orchestration-only (boundary rule).
  const policyDiagnostic = createPolicyDiagnostic({
    getMemberRole: (orgId, uid) => getMemberRole(db, orgId, uid),
    hasActiveGrant: (input) => hasActiveGrant(db, input),
  })
  const policyAdmin = createPolicyAdminOps({
    isCoreCapability: (cap) => isCoreCapability(cap as Capability),
    isBlockedCapability: (cap) => isBlockedCapability(cap as Capability),
    listAllCapabilities,
    policyVersion: EXECUTION_POLICY_VERSION,
    explainPolicyDecision: (input) => policyDiagnostic(input),
    // BQC-4.4: content-free region diagnostic — the org-scoped loader treats
    // cross-org properties as missing; the router reports the fresh decision;
    // cell + provider ref are logical identifiers, never URLs.
    getRegionDiagnostic: createRegionDiagnostic({
      loadPropertyRegion: createPropertyRegionLoader({ db }),
      resolveRouting: (propertyId) => processingRouter.resolve(propertyId, 'review.sync'),
      cell: env.PROCESSING_CELL,
      providerRef: providerRefForCell(env.PROCESSING_CELL) ?? null,
    }),
    setOrganizationPolicy: (input) => setOrganizationPolicy(db, input),
    setPropertyPolicy: (input) => setPropertyPolicy(db, input),
    addOrganizationCapability: (orgId, cap, by) =>
      addOrganizationCapability(db, orgId, cap, by),
    removeOrganizationCapability: (orgId, cap) =>
      removeOrganizationCapability(db, orgId, cap),
    isOrgMember: (orgId, uid) => isOrgMember(db, orgId, uid),
    loadOrgPolicyState: (orgId) => loadOrgPolicyState(db, orgId),
    grantPropertyAccess: (input) => grantPropertyAccess(db, input),
    revokePropertyAccess: (input) => revokePropertyAccess(db, input),
    listActiveGrantsForOrg: (orgId, at) => listActiveGrantsForOrg(db, orgId, at),
    writePolicyDecision: (entry) => writePolicyDecision(db, entry),
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
  })

  const property = buildPropertyContext({
    db,
    repo: createPropertyRepository(db),
    events: eventBus,
    clock,
    staffPublicApi: staff.publicApi,
    // BQC-4.5: region move workflow. Approved cells stay {'us'} (ADR 0048) —
    // every real request denies typed + audited today. The audit sink is the
    // identity-owned policy_decision_audit (content-free, operator kind);
    // the stepper pauses/drains the cell's property-scoped queues.
    regionMove: {
      writeOperatorAudit: (entry) =>
        writePolicyDecision(db, {
          actorType: 'operator',
          actorId: entry.actorUserId,
          organizationId: entry.organizationId,
          propertyId: entry.propertyId,
          action: entry.action,
          capability: null,
          executionKind: 'operator',
          decision: entry.decision,
          reason: entry.reason.slice(0, 200),
          policyVersion: EXECUTION_POLICY_VERSION,
          correlationId: null,
        }),
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
    providerEndpoints,
  })

  // Goal context — buildGoalContext creates its own repo and cancelGoalFn internally.
  // implements review context's port. Composition root wires them.
  const googleReviewApi = createGoogleReviewApiAdapter({
    connectionRepo: integration.internal.repos.connectionRepo,
    encryption: integration.internal.repos.encryptionPort,
    refreshToken: integration.internal.useCases.refreshGoogleToken,
    logger: getLogger(),
    baseUrl: providerEndpoints.reviewsApiBaseUrl,
  })

  const review = buildReviewContext({
    db,
    events: eventBus,
    clock,
    staffPublicApi: staff.publicApi,
    googleReviewApi,
    jobQueue: infra.jobQueue,
    logger: getLogger(),
    // BQC-4.1: review sync asserts the property's region before any external
    // effect; the property context owns the routing fact (ADR 0048).
    propertyRoutingLookup: {
      getProcessingRegion: (orgId, pid) =>
        property.publicApi.getProcessingRegion(orgId, pid),
    },
    // BQC-4.2: stamp the content-free routing envelope at enqueue (telemetry;
    // the worker's dispatch-time routing gate re-resolves and decides).
    processingRouter,
  })

  // ── Inbox lookup ports (cross-context wiring) ─────────────────────
  // BQC-1.4: review.publicApi IS the governed read interface — it satisfies
  // the inbox ReviewLookupPort and metric ReviewRatingLookupPort directly.
  // No per-context eligibility adapters remain (single rule, one owner).
  const reviewLookup: import('#/contexts/inbox/application/ports/review-lookup.port').ReviewLookupPort =
    review.publicApi

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
    findByReviewId: (id, orgId) =>
      review.internal.repos.replyRepo.findByReviewId(id, orgId),
  })

  // BQC-3.4: projection source metadata (review.updated consumer + rebuild).
  const reviewSourceLookup = createReviewSourceLookupAdapter({
    findById: (id, orgId) => review.internal.repos.reviewRepo.findById(id, orgId),
    findByOrganizationId: (orgId) =>
      review.internal.repos.reviewRepo.findByOrganizationId(orgId),
    findByPropertyId: (pid, orgId) =>
      review.internal.repos.reviewRepo.findByPropertyId(pid, orgId),
  })

  const inbox = buildInboxContext({
    db,
    events: eventBus,
    clock,
    staffPublicApi: staff.publicApi,
    reviewLookup,
    reviewSourceLookup,
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
  // Goal context — buildGoalContext creates its own repo and cancelGoalFn internally.
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
  // assignment for the invitee. We use createStaffAssignmentSystem (skips
  // can(), the membership gate, property-access scoping, and the
  // self-assignment guard BY DESIGN) instead of forging an AccountAdmin
  // AuthContext to satisfy createStaffAssignment's checks — deep-review §9
  // (AuthContext forgery). Reachable only here; tagged system-initiated
  // (no human actor in the audit trail).
  const createSystemStaffAssignment = createStaffAssignmentSystem({
    assignmentRepo: staffRepo,
    commandStore: staff.internal.commandStore,
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
    // BQC-2.7: least-privilege policy administration operations.
    policyAdmin,
    portalPublicApi: portal.publicApi,
    notificationRepo: notification.internal.repos.notificationRepo,
    notificationEmailRepo: notification.internal.repos.emailRepo,
    notificationPrefRepo: notification.internal.repos.prefRepo,
    // BQC-2.2: version-gated strong read of persisted policy state.
    // Workers await this before starting; side-effect paths use it for
    // fresh reads (BQC-2.5).
    refreshPolicyStore: infra.policyStore.refresh,
    // BQR-2.2/2.4: worker calls this before optional durable dispatch start.
    registerOutboxConsumers: createOutboxConsumerRegistrar({
      commandStore: inbox.internal.commandStore,
      reviewLookup,
      reviewSourceLookup,
      inboxRepo: inbox.internal.repos.inboxRepo,
      idGen: () => inboxItemId(crypto.randomUUID()),
      clock,
    }),
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
