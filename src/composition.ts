// Composition root — selects the enabled context modules and supplies the
// cross-context adapters and true root scalars. This is the only place where
// the full container is built. Both server and worker build it and use it.
//
// Each context's build.ts owns its internal wiring (repos, adapters, use
// cases, event handlers) and exposes only what composition needs: the
// server/application interface (publicApi + internal), plus readiness/runtime
// contributions where required (identity: refreshPolicyStore; Review worker
// registration; Inbox reminder release/outbox consumers) and the optional
// shutdown hook (none today).
// The root does NOT import individual use cases, event handlers, or business
// rules. Worker/job/consumer/schedule registration is owned by BQC-3
// (bootstrap.ts + worker/) — the root consumes that runtime registry as one
// accepted interface and never introduces another.
//
// Per architecture: "No DI framework, no auto-wiring, no decorators.
// Dependencies are passed as function arguments. The wiring is in composition.ts, visible."

import { getDb } from '#/shared/db'
import type { Database } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import type { Pool } from 'pg'
import { getLogger } from '#/shared/observability/logger'
import { getRedis } from '#/shared/cache/redis'
import { createEventBus } from '#/shared/events/event-bus'
import type { EventBus } from '#/shared/events/event-bus'
import {
  createBusAuthorizer,
  createScheduledScopeAuthorizer,
} from '#/shared/jobs/delayed-execution-gate'
import { createJobQueue, closeJobQueueConnections } from '#/shared/jobs/queue'
import { QUARANTINE_QUEUE_NAME } from '#/shared/jobs/failure-quarantine'
import { createOperationsSnapshot } from '#/shared/health/operations-snapshot'
import { JOB_OPERATIONAL_CONTRACTS } from '#/shared/jobs/operational-catalogue'
import {
  createJobRuntimeReportReader,
  createQueueJobRuntimeObservationStore,
  type JobRuntimeQueueRedisSource,
} from '#/shared/jobs/runtime-observations'
import { createAlertDispatcher } from '#/shared/observability/alert-dispatcher'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { createConsumerRegistry } from '#/shared/outbox'
import { resolveCutoverState } from '#/shared/outbox/cutover-flags'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createBetterAuthIdentityAdapter } from '#/contexts/identity/infrastructure/adapters/auth-identity.adapter'
import { createGrantAccessLookup } from '#/contexts/identity/infrastructure/adapters/grant-access-lookup.adapter'
import { BetaFeedbackTriageRepository } from '#/contexts/identity/infrastructure/beta-feedback-triage.repository'
import {
  bindProcessPolicies,
  registerProcessPolicyColdBoot,
} from '#/shared/auth/process-policy-binding'
import type { IdentityPort } from '#/contexts/identity/application/ports/identity.port'
import type { GoogleOAuthProviderCallAuthorizer } from '#/contexts/integration/application/ports/google-oauth.port'
import type { GoogleImportContentAuthorizer } from '#/contexts/integration/application/google-import-command-authorizer'
import { createGoogleContentAuthorizationCheck } from '#/contexts/integration/infrastructure/google-content-authorization-check'
import {
  authorityAdmissionCode,
  createGoogleAuthorizedProviderExecutor,
} from '#/contexts/integration/infrastructure/adapters/google-authorized-provider-executor.adapter'
import { createDurableGoogleImportReferenceStore } from '#/contexts/integration/infrastructure/durable-import-reference-store'
import { createGoogleDisconnectRevokeRepository } from '#/contexts/integration/infrastructure/repositories/google-disconnect-revoke.repository'
import { createGoogleCredentialBinder } from '#/shared/google-provider-control/credential-binding'
import { createGoogleEgressGatewayHttpClient } from '../services/google-egress-gateway/http-api'
import {
  createInternalMtlsJsonTransport,
  loadInternalMtlsMaterialFromOneSource,
} from '../services/internal-mtls'
import { createGoogleContentAuthorityRepository } from '#/contexts/identity/infrastructure/repositories/google-content-authority.repository'
import { createGoogleContentAuthorizationAuthority } from '#/shared/auth/google-content-authority'
import {
  createGoogleContentRoleSignatureVerifier,
  parseGoogleContentRolePublicKeys,
} from '#/shared/auth/google-content-approval'
import { parseGoogleContentRuntimeBindings } from '#/shared/auth/google-content-runtime-bindings'
import type { PerformanceContentAuthorizer } from '#/contexts/integration/application/google-performance-authorizer'
import type { GoogleReviewSyncContentAuthorizer } from '#/contexts/integration/application/google-review-sync-authorizer'
import type { GoogleReplyPublicationContentAuthorizer } from '#/contexts/integration/application/google-reply-publication-authorizer'
import {
  buildIdentityContext,
  createInvitationPropertyAccessProvisioner,
  type IdentityOrganizationLifecycleComposition,
} from '#/contexts/identity/build'
import { CAPABILITY_POLICY_VERSION } from '#/shared/auth/beta-capabilities'
import { EXECUTION_POLICY_VERSION } from '#/shared/auth/execution-policy'
import { ROUTING_POLICY_VERSION } from '#/contexts/property/domain/processing-routing'
import { createGoogleSourceContentPolicy } from '#/shared/domain/source-content-policy'
import { getAuth, INVITATION_EXPIRY_SECONDS } from '#/shared/auth/auth'
import { sendInvitationEmail } from '#/shared/auth/emails'
import { headersFromContext } from '#/shared/auth/headers'
import { getEnv, getReleaseSha } from '#/shared/config/env'
import type { Env } from '#/shared/config/env'
import {
  assertDirectCredentialEgressAllowed,
  assertDirectProviderEgressAllowed,
  assertReviewProviderSubjectKeysConfigured,
} from '#/shared/config/provider-config-guards'
import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Clock } from '#/shared/domain/clock'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  recentActivityEntryId,
  feedbackId,
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { buildPropertyContext } from '#/contexts/property/build'
import { operationalActionHistoryRecordId } from '#/contexts/activity/domain/operational-action-history'
import { createInboxCommandAuthority } from '#/contexts/inbox/infrastructure/adapters/inbox-command-authority.adapter'
import { createPropertyRepository } from '#/contexts/property/infrastructure/repositories/property.repository'
import { createPropertyRoutingLoader } from '#/contexts/property/infrastructure/property-routing.adapter'
import { createPropertyRegionLoader } from '#/contexts/property/infrastructure/property-region-loader'
import { createProcessingRouter } from '#/shared/routing/processing-router'
import { providerRefForCell } from '#/shared/routing/processing-router'
import { createDataCellExecutionFence } from '#/shared/routing/data-cell-execution-fence'
import { parseGoogleCredentialBrokerRuntimeConfig } from '#/shared/routing/google-credential-broker-runtime'
import { createDirectGoogleProviderCredentialAdmission } from '#/contexts/integration/infrastructure/adapters/google-credential-provider-admission.adapter'
import { buildIntegrationContext } from '#/contexts/integration/build'
import { createImportItemRoutingLoader } from '#/contexts/integration/infrastructure/import-item-routing.adapter'
import { createOAuthStateHandleService } from '#/contexts/integration/application/oauth-state-handle'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { ProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import { createRedisProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import { createProviderEphemeralRedis } from '#/shared/provider-ephemeral/redis-client'
import { createInMemoryProviderEphemeralStore } from '#/shared/provider-ephemeral/in-memory-store'
import { createProviderAuthorizationLeaseService } from '#/shared/provider-ephemeral/authorization-lease'
import { providerAuthorizationFenceSha256 } from '#/shared/provider-ephemeral/authorization-binding'
import {
  validateProviderEphemeralRedisUrls,
  verifyProviderEphemeralRedisRuntime,
  type ProviderRedisReadiness,
} from '#/shared/provider-ephemeral/runtime-verification'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { validateGoogleRuntimeIsolationReadiness } from '#/shared/auth/google-runtime-isolation'
import {
  createInMemoryOAuthCallbackQuotaCounter,
  createOAuthCallbackAbuseGate,
  type OAuthCallbackQuotaCounter,
} from '#/contexts/integration/application/oauth-callback-abuse-gate'
import { createRedisOAuthCallbackQuotaCounter } from '#/contexts/integration/infrastructure/oauth-callback-quota-counter'
import { createRedisGoogleRefreshCoordination } from '#/contexts/integration/infrastructure/adapters/google-refresh-coordination.adapter'
import { buildStaffContext } from '#/contexts/staff/build'
import { buildPortalContext } from '#/contexts/portal/build'
import { buildGuestContext } from '#/contexts/guest/build'
import { buildReviewContext } from '#/contexts/review/build'
import { createSourceContentPurge } from '#/contexts/review/infrastructure/source-content-purge'
import { configureReviewProviderSubjectWriterKeys } from '#/contexts/review/application/provider-subject-keyring'
import { buildInboxContext } from '#/contexts/inbox/build'
import { buildMetricContext } from '#/contexts/metric/build'
import { buildDashboardContext } from '#/contexts/dashboard/build'
import { buildGoalContext } from '#/contexts/goal/build'
import { buildActivityContext } from '#/contexts/activity/build'
import { buildNotificationContext } from '#/contexts/notification/build'
import { buildAiContext } from '#/contexts/ai/build'
import { GENERATE_PROPERTY_TREND_JOB_NAME } from '#/contexts/ai/infrastructure/jobs/generate-property-trend.job'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import { isEligibleResponsibleManager } from '#/shared/responsible-manager-eligibility'
import {
  applyProviderEndpointOverrides,
  createAiRuntimeProviders,
  providerConfigFor,
  type ProviderOverrides,
} from './composition/provider-runtime'
import { buildInfrastructure } from './composition/infrastructure'
import { bindPropertyCapabilityProvisioning } from './composition/property-capability-provisioning'
import {
  createContainerShutdown,
  type ContainerShutdown,
} from './composition/container-lifecycle'

export {
  applyProviderEndpointOverrides,
  providerConfigFor,
  type ProviderOverrides,
} from './composition/provider-runtime'
export { bindPropertyCapabilityProvisioning } from './composition/property-capability-provisioning'

// ── Identity infrastructure helpers ────────────────────────────────

function createSetActiveOrg(logger: Pick<LoggerPort, 'warn'>) {
  return async (orgId: string): Promise<void> => {
    const auth = getAuth()
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
      logger.warn({ err: e }, 'Failed to set active organization during setup')
    }
  }
}

// ── Main container ─────────────────────────────────────────────────

// Accepted residual (BQC-5.2/BQC-5.7): per-dependency override pattern is
// inherently branchy; extraction would scatter the wiring. Owner: BQC-5.2.
// fallow-ignore-next-line complexity
export function createContainer(options?: {
  enableJobs?: boolean
  /** Testing/simulation-only mutation surface. Normal application containers
   * omit it entirely so production code cannot acquire repository writes. */
  exposeSimulationRuntime?: true
  /** Override the database connection (simulations, per-test isolation). */
  db?: Database
  /** Override the PostgreSQL session pool used by advisory-lock and COPY-style
   * infrastructure that cannot run through the Drizzle connection facade. */
  pool?: Pool
  /** Override Redis. Supplying the key with `undefined` explicitly disables
   * ambient Redis for deterministic simulations and process fixtures. */
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
  /** Override the ops domain-events read handle (simulations/tests inject an
   * in-memory queue — the real one opens a dedicated Redis connection). */
  opsDomainEventsQueue?: Queue
  /** Override the ops background read handle. The web process needs this
   * read-only handle without gaining scheduler/worker authority. */
  opsBackgroundQueue?: Queue
  /** Override the ops quarantine read handle (same rationale). */
  opsQuarantineQueue?: Queue
  /** Override the identity port (simulations use the in-memory identity fake). */
  identityPort?: IdentityPort
  /** Dedicated non-persistent provider store override for simulations/tests. */
  providerEphemeralStore?: ProviderEphemeralStore
  /** Override the email sender (simulations capture emails instead of sending). */
  email?: typeof sendInvitationEmail
  /** Override external provider adapters (BQC-6.1: deterministic Google/GBP/
   * storage by injection — simulations/tests never hit the network). */
  providers?: ProviderOverrides
  /**
   * Reviewed Organization lifecycle/export contributors. Production leaves
   * this absent until every owning context has explicit retention semantics;
   * a partial set remains visible in readiness but cannot execute.
   */
  organizationLifecycle?: IdentityOrganizationLifecycleComposition
}) {
  const { enableJobs = false } = options ?? {}
  const db = options?.db ?? getDb()
  const betaFeedbackTriageRepo = BetaFeedbackTriageRepository.create(db)
  const pool = options?.pool ?? getPool()
  const logger = getLogger()
  const redis = options && 'redis' in options ? options.redis : getRedis()
  // BQC-3.2: the composition root wires the bus authorizer to the delayed
  // execution gate; bare createEventBus() (tests, Storybook, browser) stays
  // ungoverned and free of server-only policy imports.
  const eventBus =
    options?.eventBus ?? createEventBus({ authorizeConsumer: createBusAuthorizer() })
  const clock = options?.clock ?? (() => new Date())
  const env = options?.env ?? getEnv()
  // Boot-time all-or-none validation only. Cross-cell effects remain dark;
  // this proves a Railway public TCP deployment cannot start with partial,
  // private-DNS, cleartext, or unpinned broker transport configuration.
  parseGoogleCredentialBrokerRuntimeConfig(env)
  if (
    env.REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS !== undefined ||
    (!enableJobs && env.REVIEW_PROVIDER_SUBJECT_HMAC_KEYS !== undefined)
  ) {
    throw new Error('config_invalid')
  }
  // Fail CLOSED at boot, not once per job: a production worker without the
  // subject keyring fails 100% of review syncs at acquireDeriver() with an
  // opaque `config_invalid`, surfacing only after three retries in
  // quarantine. This names the variable and refuses to build the container.
  // No-op outside production and for non-job processes.
  assertReviewProviderSubjectKeysConfigured(env, enableJobs)
  const reviewProviderSubjectKeyring = configureReviewProviderSubjectWriterKeys({
    writerEnabled: enableJobs,
    production: env.NODE_ENV === 'production',
    raw: env.REVIEW_PROVIDER_SUBJECT_HMAC_KEYS,
  })

  // BQC-7.3 (release.sha): deploy identity at boot — one line per container
  // build (singleton in prod; simulations/tests build per scenario).
  logger.info({ releaseSha: getReleaseSha(env) }, 'composition root boot')

  // BQC-4.3: resolve the cell's approved provider endpoints ONCE from the
  // router's cell config (PROCESSING_CELL → logical provider ref → endpoint
  // construction config). Fails closed at startup for a cell with no approved
  // provider — unavailability is never papered over by another endpoint.
  // BQC-6.5: explicit operator env overrides (sandbox seam) applied once here;
  // all absent = byte-identical passthrough.
  const providerEndpoints = applyProviderEndpointOverrides(
    providerConfigFor(providerRefForCell(env.PROCESSING_CELL)),
    env,
  )
  const runtimeIsolationConfigured =
    env.GOOGLE_RUNTIME_ISOLATION_PROFILE_JSON !== undefined ||
    env.GOOGLE_CONTROL_PLANE_POLICY_GENERATION !== undefined
  if (env.NODE_ENV === 'production' && runtimeIsolationConfigured) {
    if (
      !env.GOOGLE_RUNTIME_ISOLATION_PROFILE_JSON ||
      !env.GOOGLE_CONTROL_PLANE_POLICY_GENERATION
    ) {
      throw new Error(
        'Configured Google runtime isolation requires a profile and live attestation',
      )
    }
    const expectedGoogleOrigins = [
      ...new Set(
        Object.values(providerEndpoints).map((endpoint) => new URL(endpoint).origin),
      ),
    ]
    validateGoogleRuntimeIsolationReadiness({
      profileRaw: env.GOOGLE_RUNTIME_ISOLATION_PROFILE_JSON,
      attestationRaw: readFileSync('/run/repkey/google-egress-attestation.json', 'utf8'),
      expectedControlPlanePolicyGeneration: env.GOOGLE_CONTROL_PLANE_POLICY_GENERATION,
      expectedGoogleOrigins,
      expectedTargetEnvironment:
        env.GOOGLE_PROVIDER_ENDPOINT_PROFILE === 'local-sandbox'
          ? 'local_sandbox'
          : 'production',
      now: clock(),
    })
  }
  let providerEphemeralRedis: Redis | undefined
  let providerEphemeralStore = options?.providerEphemeralStore
  let oauthStateHandles: ReturnType<typeof createOAuthStateHandleService> | undefined
  let providerEphemeralReadiness: Promise<ProviderRedisReadiness> | undefined
  let googleImportReplayKeys: ReturnType<typeof createVersionedHmacKeyring> | undefined
  let googleOpaqueReferenceKeys: ReturnType<typeof createVersionedHmacKeyring> | undefined
  {
    if (!providerEphemeralStore && env.PROVIDER_EPHEMERAL_REDIS_URL) {
      if (env.NODE_ENV === 'production') {
        const urlFailure = validateProviderEphemeralRedisUrls(
          env.PROVIDER_EPHEMERAL_REDIS_URL,
          env.REDIS_URL,
          env.QUEUE_REDIS_URL,
        )
        if (urlFailure) {
          throw new Error(`Provider-ephemeral Redis denied: ${urlFailure.code}`)
        }
      }
      providerEphemeralRedis = createProviderEphemeralRedis(
        env.PROVIDER_EPHEMERAL_REDIS_URL,
        env.PROVIDER_EPHEMERAL_REDIS_CA_PEM,
      )
      providerEphemeralStore = createRedisProviderEphemeralStore(providerEphemeralRedis)
      providerEphemeralReadiness =
        verifyProviderEphemeralRedisRuntime(providerEphemeralRedis)
    }
    if (!providerEphemeralStore) {
      if (env.NODE_ENV === 'production') {
        throw new Error('Opaque OAuth state requires provider-ephemeral Redis')
      }
      providerEphemeralStore = createInMemoryProviderEphemeralStore()
    }
    const fallbackKey = createHash('sha256').update(env.OAUTH_STATE_SECRET).digest('hex')
    const requiredKeyring = (raw: string | undefined, name: string): string => {
      if (raw) return raw
      if (env.NODE_ENV === 'production') {
        throw new Error(`${name} is required for opaque OAuth state`)
      }
      return `local:${fallbackKey}`
    }
    googleOpaqueReferenceKeys = createVersionedHmacKeyring(
      requiredKeyring(
        env.GOOGLE_OPAQUE_REFERENCE_HMAC_KEYS,
        'GOOGLE_OPAQUE_REFERENCE_HMAC_KEYS',
      ),
    )
    googleImportReplayKeys = createVersionedHmacKeyring(
      requiredKeyring(env.GOOGLE_REPLAY_HMAC_KEYS, 'GOOGLE_REPLAY_HMAC_KEYS'),
    )
    oauthStateHandles = createOAuthStateHandleService({
      store: providerEphemeralStore,
      handleKeys: createVersionedHmacKeyring(
        requiredKeyring(
          env.GOOGLE_OAUTH_STATE_HANDLE_HMAC_KEYS,
          'GOOGLE_OAUTH_STATE_HANDLE_HMAC_KEYS',
        ),
      ),
      sessionKeys: createVersionedHmacKeyring(
        requiredKeyring(
          env.GOOGLE_SESSION_BINDING_HMAC_KEYS,
          'GOOGLE_SESSION_BINDING_HMAC_KEYS',
        ),
      ),
      ensureRuntimeReady: providerEphemeralReadiness
        ? async () => {
            const readiness = await providerEphemeralReadiness!
            if (!readiness.ok) {
              throw new Error(`Provider-ephemeral Redis denied: ${readiness.code}`)
            }
          }
        : undefined,
    })
  }

  if (env.NODE_ENV === 'production' && !redis) {
    throw new Error('Production Google credential refresh coordination requires Redis')
  }
  const googleRefreshCoordination =
    redis && googleOpaqueReferenceKeys
      ? createRedisGoogleRefreshCoordination({
          redis,
          connectionKeys: googleOpaqueReferenceKeys,
          nowMs: () => clock().getTime(),
          sleep: (durationMs) =>
            new Promise<void>((resolve) => {
              setTimeout(resolve, durationMs)
            }),
          ownerId: randomUUID,
          jitterSample: () => randomBytes(4).readUInt32BE(0),
        })
      : undefined

  // Infrastructure
  const infra = buildInfrastructure({
    redis,
    enableJobs,
    queue: options?.queue,
    backgroundQueue: options?.backgroundQueue,
  })

  // Identity port (adapter). Invitation property-access provisioning is a
  // context-owned capability injected into this adapter instance; it is not a
  // process-global Better Auth callback and cannot be replaced by another
  // independently constructed process fixture.
  const invitationPropertyAccessProvisioner = createInvitationPropertyAccessProvisioner({
    db,
    clock,
    logger,
  })
  const identityPort =
    options?.identityPort ??
    createBetterAuthIdentityAdapter(db, {
      clock,
      idGen: randomUUID,
      logger,
      onAcceptInvitation: invitationPropertyAccessProvisioner,
    })
  // Late-bound because Identity is upstream of Portal/Property/Inbox. Requests
  // cannot reach the callback until the container has finished composing.
  let releaseMemberAuthorities = async (
    _organizationId: string,
    _userId: string,
    _actorId: string | null,
  ): Promise<void> => {
    throw new Error('Member authority lifecycle unavailable')
  }
  let reconcileResponsibleManagerEligibility = async (
    _organizationId: string,
    _userId: string,
    _actorId: string,
  ): Promise<void> => {
    throw new Error('Responsible manager eligibility lifecycle unavailable')
  }

  // BQC-4.2: the ONE routing decision model — shared by the review context
  // (enqueue envelope stamping) and the BQC-4.4 operator region diagnostic.
  const loadPropertyRouting = createPropertyRoutingLoader({ db })
  const dataCellExecutionFence = createDataCellExecutionFence({
    localCell: env.PROCESSING_CELL,
    loadPropertyRouting,
  })
  const processingRouter = createProcessingRouter({
    loadPropertyRouting,
    loadImportItemRouting: createImportItemRoutingLoader({ db }),
  })

  // PRE17A A4: Create outbox repository and register event schemas.
  // The outbox records domain events durably. Event schemas are registered
  // once at startup so the relay can validate payloads before publishing.
  const outboxRepo = createOutboxRepository(db)
  // ARC-03-T7: the durable consumer registry is CONTAINER-OWNED. It used to be
  // a module-level Map whose duplicate check spanned the whole process, so a
  // second container could not register its consumers at all. Every context
  // registers into this instance; the worker's readiness gate and the
  // dispatcher read the same one.
  const consumerRegistry = createConsumerRegistry()
  registerAllEventSchemas()

  // ── Context builds (dependency order) ──────────────────────────────
  const staff = buildStaffContext({
    db,
    // BQC-2.3: property scope resolves from the identity-owned grant
    // repository (ADR 0039) — never from staff_assignments.
    accessiblePropertyLookup: createGrantAccessLookup(db, clock),
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
    clock,
    idGen: randomUUID,
    reconcileResponsibleManagerEligibility: (orgId, userIdValue, actorId) =>
      reconcileResponsibleManagerEligibility(orgId, userIdValue, actorId),
  })

  const identity = buildIdentityContext({
    db,
    identityPort,
    events: eventBus,
    clock,
    idGen: randomUUID,
    signUp: identityPort.signUp,
    setActiveOrg: createSetActiveOrg(logger),
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
    logger,
    // BQC-2.2/2.7/4.4: identity owns the policy store, admin ops, and the
    // operator audit sink; the root supplies env + the shared routing
    // primitives (property region loader, router decision).
    policy: {
      env,
      loadPropertyRegion: createPropertyRegionLoader({ db }),
      // Late-bound because identity is constructed before the property context.
      // The callback runs only after the container is fully composed.
      propertyBelongsToOrganization: (orgId, pid) =>
        property.publicApi.propertyExists(organizationId(orgId), propertyId(pid)),
      resolveRouting: (pid) =>
        processingRouter.resolve({ kind: 'property', propertyId: pid }, 'review.sync'),
      cell: env.PROCESSING_CELL,
      admitPropertyExecution: dataCellExecutionFence.decideProperty,
      providerRef: providerRefForCell(env.PROCESSING_CELL) ?? null,
    },
    cancelGoogleImportsForUser: (orgId, userIdValue) => {
      const cancel = integration.lifecycle.cancelImportsForUser
      if (!cancel) throw new Error('Google import lifecycle unavailable')
      return cancel(orgId, userIdValue).then(() => undefined)
    },
    prepareGoogleConnectorDeparture: async (orgId, userIdValue, cause) => {
      await integration.lifecycle.prepareConnectorDeparture({
        organizationId: organizationId(orgId),
        connectorUserId: userId(userIdValue),
        cause,
      })
    },
    releaseMemberAuthorities: (orgId, userIdValue, actorId) =>
      releaseMemberAuthorities(orgId, userIdValue, actorId),
    reconcileResponsibleManagerEligibility: (orgId, userIdValue, actorId) =>
      reconcileResponsibleManagerEligibility(orgId, userIdValue, actorId),
    verifyMerchantAiStepUp: async ({ headers, password }) => {
      try {
        const result = await getAuth().api.verifyPassword({
          headers,
          body: { password },
        })
        return result.status === true
      } catch {
        return false
      }
    },
    ...(options?.organizationLifecycle
      ? { organizationLifecycle: options.organizationLifecycle }
      : {}),
  })

  const googleContentRuntimeBindings = env.GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON
    ? parseGoogleContentRuntimeBindings(env.GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON)
    : undefined
  let googleContentAuthority:
    ReturnType<typeof createGoogleContentAuthorizationAuthority<Database>> | undefined
  let googleContentAuthorityStore:
    ReturnType<typeof createGoogleContentAuthorityRepository> | undefined
  if (googleContentRuntimeBindings) {
    const rawPublicKeys = env.GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON
    if (!rawPublicKeys) {
      throw new Error('Google Content approval role public keys are unavailable')
    }
    let publicKeysInput: unknown
    try {
      publicKeysInput = JSON.parse(rawPublicKeys)
    } catch {
      throw new Error('Google Content approval role public keys are invalid')
    }
    const publicKeys = parseGoogleContentRolePublicKeys(publicKeysInput)
    if (!publicKeys.ok) {
      throw new Error('Google Content approval role public keys are invalid')
    }
    googleContentAuthorityStore = createGoogleContentAuthorityRepository(db)
    googleContentAuthority = createGoogleContentAuthorizationAuthority({
      store: googleContentAuthorityStore,
      clock,
      newPermitId: randomUUID,
      verifyRoleApproval: createGoogleContentRoleSignatureVerifier(publicKeys.publicKeys),
      refreshPolicy: identity.internal.refreshPolicyStoreRequired,
      isRegisteredOperator: () => false,
      authorize: createGoogleContentAuthorizationCheck({
        clock,
        hasActivePropertyGrant: identity.internal.hasActivePropertyGrant,
      }),
    })
  }
  const ensureProviderEphemeralReady = providerEphemeralReadiness
    ? async () => {
        const readiness = await providerEphemeralReadiness
        if (!readiness.ok) {
          throw new Error(`Provider-ephemeral Redis denied: ${readiness.code}`)
        }
      }
    : undefined
  const defaultProviderAuthorizationLeases =
    providerEphemeralStore && googleOpaqueReferenceKeys
      ? createProviderAuthorizationLeaseService({
          store: providerEphemeralStore,
          handleKeys: googleOpaqueReferenceKeys,
          randomNonce: () => randomBytes(32).toString('base64url'),
          ensureRuntimeReady: ensureProviderEphemeralReady,
          revalidate: async (record) => {
            const runtimeBinding = googleContentRuntimeBindings?.[record.capability]
            if (!runtimeBinding || !googleContentAuthority) {
              return {
                allowed: false,
                approvalBindingId: null,
                authorizationFenceSha256: null,
              }
            }
            try {
              const result = await googleContentAuthority.preauthorize({
                runtimeBinding,
                scope: {
                  organizationId: record.organizationId,
                  propertyId: record.propertyId,
                  connectionId: record.connectionId,
                  initiatorUserId: record.initiatorUserId,
                },
                operationKey: `${record.audience}.lease_renewal`,
                vectorMode: 'full',
              })
              if (!result.ok) {
                return {
                  allowed: false,
                  approvalBindingId: null,
                  authorizationFenceSha256: null,
                }
              }
              const lifecycleVersion =
                result.authorizationVector.connectionLifecycleVersion
              const accessVersion = result.authorizationVector.connectionAccessVersion
              const credentialGeneration = result.authorizationVector.credentialGeneration
              if (
                !Number.isSafeInteger(lifecycleVersion) ||
                !Number.isSafeInteger(accessVersion) ||
                !Number.isSafeInteger(credentialGeneration)
              ) {
                return {
                  allowed: false,
                  approvalBindingId: null,
                  authorizationFenceSha256: null,
                }
              }
              return {
                allowed: true,
                approvalBindingId: result.approvalBindingId,
                authorizationFenceSha256: providerAuthorizationFenceSha256({
                  connectionLifecycleVersion: lifecycleVersion as number,
                  connectionAccessVersion: accessVersion as number,
                  authorizationVector: result.authorizationVector,
                }),
              }
            } catch {
              return {
                allowed: false,
                approvalBindingId: null,
                authorizationFenceSha256: null,
              }
            }
          },
        })
      : undefined
  const providerAuthorizationLeases =
    options?.providers?.providerAuthorizationLeases ?? defaultProviderAuthorizationLeases
  const googleImportReferences =
    options?.providers?.googleImportReferences ??
    (googleOpaqueReferenceKeys && providerAuthorizationLeases
      ? createDurableGoogleImportReferenceStore({
          db,
          handleKeys: googleOpaqueReferenceKeys,
          leasePrincipalKeys: googleOpaqueReferenceKeys,
          leases: providerAuthorizationLeases,
          clock,
        })
      : undefined)
  const googlePerformancePrincipalKeys =
    options?.providers?.googlePerformancePrincipalKeys ?? googleOpaqueReferenceKeys

  const unavailableGoogleContentAuthorization = Object.freeze({
    ok: false as const,
    code: 'runtime_unavailable' as const,
  })
  const authorizeGoogleImportContent: GoogleImportContentAuthorizer =
    options?.providers?.authorizeGoogleImportContent ??
    (async (input) => {
      const binding = googleContentRuntimeBindings?.['property.import_gbp_v2']
      if (!binding || !googleContentAuthority) {
        return unavailableGoogleContentAuthorization
      }
      const result = await googleContentAuthority
        .preauthorize({
          runtimeBinding: binding,
          scope: {
            organizationId: input.actor.organizationId,
            propertyId: null,
            connectionId: input.connectionId,
            initiatorUserId: input.actor.userId,
          },
          operationKey: `import.${input.phase}`,
          vectorMode: 'full',
        })
        .catch((err: unknown) => {
          logger.warn({ err }, 'Google Content preauthorization failed')
          throw err
        })
      if (result.ok) return result
      logger.warn(
        { stage: 'google-content-preauthorize', code: result.code },
        'Google Content authorization denied',
      )
      return {
        ok: false as const,
        code:
          result.code === 'authorization_denied' ||
          result.code === 'authorization_changed'
            ? ('authorization_denied' as const)
            : ('runtime_unavailable' as const),
      }
    })
  const authorizeGooglePerformanceContent: PerformanceContentAuthorizer =
    options?.providers?.authorizeGooglePerformanceContent ??
    (async (input) => {
      const binding = googleContentRuntimeBindings?.['property.read_gbp_performance']
      if (!binding || !googleContentAuthority) {
        return unavailableGoogleContentAuthorization
      }
      const result = await googleContentAuthority.preauthorize({
        runtimeBinding: binding,
        scope: {
          organizationId: input.actor.organizationId,
          propertyId: input.propertyId,
          connectionId: input.connectionId,
          initiatorUserId: input.actor.userId,
        },
        operationKey: `performance.${input.phase}`,
        vectorMode: 'full',
      })
      return result.ok
        ? result
        : {
            ok: false as const,
            code:
              result.code === 'authorization_denied' ||
              result.code === 'authorization_changed'
                ? ('authorization_denied' as const)
                : ('runtime_unavailable' as const),
          }
    })
  const authorizeGoogleReviewSyncContent: GoogleReviewSyncContentAuthorizer =
    options?.providers?.authorizeGoogleReviewSyncContent ??
    (async (input) => {
      const binding = googleContentRuntimeBindings?.['property.connect_gbp']
      if (!binding || !googleContentAuthority) {
        return unavailableGoogleContentAuthorization
      }
      const result = await googleContentAuthority.preauthorize({
        runtimeBinding: binding,
        scope: {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          connectionId: input.connectionId,
          initiatorUserId: null,
        },
        operationKey: input.operationKey,
        vectorMode: 'full',
      })
      return result.ok
        ? result
        : {
            ok: false as const,
            code:
              result.code === 'authorization_denied' ||
              result.code === 'authorization_changed'
                ? ('authorization_denied' as const)
                : ('runtime_unavailable' as const),
          }
    })
  const authorizeGoogleReplyPublicationContent: GoogleReplyPublicationContentAuthorizer =
    options?.providers?.authorizeGoogleReplyPublicationContent ??
    (async (input) => {
      const binding = googleContentRuntimeBindings?.['property.publish_reply']
      if (!binding || !googleContentAuthority) {
        return unavailableGoogleContentAuthorization
      }
      const result = await googleContentAuthority.preauthorize({
        runtimeBinding: binding,
        scope: {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          connectionId: input.connectionId,
          initiatorUserId: null,
          publication: {
            reviewId: input.reviewId,
            replyId: input.replyId,
            publicationCycle: input.publicationCycle,
            attemptNumber: input.attemptNumber,
            sourceEpoch: input.sourceEpoch,
            materialReviewRevision: input.materialReviewRevision,
          },
        },
        operationKey: input.operationKey,
        vectorMode: 'full',
      })
      return result.ok
        ? result
        : {
            ok: false as const,
            code:
              result.code === 'authorization_denied' ||
              result.code === 'authorization_changed'
                ? ('authorization_denied' as const)
                : ('runtime_unavailable' as const),
          }
    })
  const authorizeGoogleOAuthProviderCall: GoogleOAuthProviderCallAuthorizer =
    options?.providers?.authorizeGoogleOAuthProviderCall ??
    (async (input) => {
      if (input.disconnectRevoke && input.operation !== 'oauth.revoke') {
        throw new Error('Google OAuth cleanup authority is inconsistent')
      }
      const binding = googleContentRuntimeBindings?.['property.import_gbp_v2']
      if (!binding || !googleContentAuthority) {
        throw new Error('Google OAuth provider authorization is unavailable')
      }
      const result = await googleContentAuthority.preauthorize({
        runtimeBinding: binding,
        scope: {
          organizationId: input.organizationId,
          propertyId: null,
          connectionId: input.connectionId,
          initiatorUserId: input.initiatorUserId,
        },
        operationKey: input.operation,
        vectorMode: 'full',
      })
      const credentialGeneration = result.ok
        ? result.authorizationVector.credentialGeneration
        : null
      if (
        !result.ok ||
        typeof credentialGeneration !== 'number' ||
        !Number.isSafeInteger(credentialGeneration) ||
        credentialGeneration < 0
      ) {
        throw new Error('Google OAuth provider authorization is unavailable')
      }
      return Object.freeze({
        capability: 'property.import_gbp_v2' as const,
        organizationId: organizationId(input.organizationId),
        propertyId: null,
        connectionId: googleConnectionId(input.connectionId),
        initiatorUserId: input.initiatorUserId,
        approvalBindingId: result.approvalBindingId,
        expectedCredentialGeneration: credentialGeneration,
        authorizationVector: result.authorizationVector,
        ...(input.disconnectRevoke
          ? {
              disconnectRevoke: Object.freeze({
                attemptId: input.disconnectRevoke.attemptId,
                cleanupDeadlineAtMs: input.disconnectRevoke.cleanupDeadlineAt.getTime(),
              }),
            }
          : {}),
      })
    })

  const googleDisconnectRevokeStore = createGoogleDisconnectRevokeRepository(db, eventBus)

  const gatewayConfig = [
    env.GOOGLE_EGRESS_GATEWAY_ORIGIN,
    env.GOOGLE_EGRESS_GATEWAY_SERVER_NAME,
    env.GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS,
  ] as const
  const gatewayBase64Tls = [
    env.GOOGLE_INTERNAL_MTLS_CA_B64,
    env.GOOGLE_INTERNAL_MTLS_CERT_B64,
    env.GOOGLE_INTERNAL_MTLS_KEY_B64,
  ] as const
  const gatewayPathTls = [
    env.GOOGLE_INTERNAL_MTLS_CA_PATH,
    env.GOOGLE_INTERNAL_MTLS_CERT_PATH,
    env.GOOGLE_INTERNAL_MTLS_KEY_PATH,
  ] as const
  const configuredGatewayValues = gatewayConfig.filter(
    (value): value is string => value !== undefined,
  )
  const configuredBase64Tls = gatewayBase64Tls.filter(
    (value): value is string => value !== undefined,
  )
  const configuredPathTls = gatewayPathTls.filter(
    (value): value is string => value !== undefined,
  )
  if (
    configuredGatewayValues.length !== 0 &&
    configuredGatewayValues.length !== gatewayConfig.length
  ) {
    throw new Error('Google egress gateway transport configuration is incomplete')
  }
  if (
    configuredBase64Tls.length !== 0 &&
    configuredBase64Tls.length !== gatewayBase64Tls.length
  ) {
    throw new Error('Google egress gateway base64 mTLS configuration is incomplete')
  }
  if (
    configuredPathTls.length !== 0 &&
    configuredPathTls.length !== gatewayPathTls.length
  ) {
    throw new Error('Google egress gateway path mTLS configuration is incomplete')
  }
  if (configuredBase64Tls.length > 0 && configuredPathTls.length > 0) {
    throw new Error('Google egress gateway mTLS configuration is ambiguous')
  }
  if (
    (configuredGatewayValues.length > 0 &&
      configuredBase64Tls.length === 0 &&
      configuredPathTls.length === 0) ||
    (configuredGatewayValues.length === 0 &&
      (configuredBase64Tls.length > 0 || configuredPathTls.length > 0))
  ) {
    throw new Error('Google egress gateway transport configuration is incomplete')
  }
  let googleAuthorizedProviderExecutor =
    options?.providers?.googleAuthorizedProviderExecutor
  if (!googleAuthorizedProviderExecutor && configuredGatewayValues.length > 0) {
    if (!googleContentAuthority || !googleContentRuntimeBindings) {
      throw new Error('Google egress gateway requires Google Content runtime approval')
    }
    const [gatewayOrigin, gatewayServerName, credentialBindingKeys] =
      configuredGatewayValues
    const bindCredential = createGoogleCredentialBinder(
      createVersionedHmacKeyring(credentialBindingKeys),
    )
    const gateway = createGoogleEgressGatewayHttpClient(
      createInternalMtlsJsonTransport({
        origin: gatewayOrigin,
        serverName: gatewayServerName,
        tls: loadInternalMtlsMaterialFromOneSource({
          base64: {
            ca: configuredBase64Tls[0],
            cert: configuredBase64Tls[1],
            key: configuredBase64Tls[2],
          },
          path: {
            ca: configuredPathTls[0],
            cert: configuredPathTls[1],
            key: configuredPathTls[2],
          },
        }),
        peerIdentityPolicy: {
          uri: 'spiffe://repkey.internal/google-egress-gateway',
          dnsName: gatewayServerName,
          extendedKeyUsages: ['serverAuth', 'clientAuth'],
        },
        timeoutMs: 30_000,
        maxResponseBytes: 5 * 1024 * 1024,
      }),
    )
    googleAuthorizedProviderExecutor = createGoogleAuthorizedProviderExecutor({
      bindCredential,
      disconnectRevoke: {
        prepare: googleDisconnectRevokeStore.prepare,
        acquireDispatch: googleDisconnectRevokeStore.acquireDispatch,
      },
      now: clock,
      admitPropertyExecution: dataCellExecutionFence.decideProperty,
      admitDirectCredentialExecution: createDirectGoogleProviderCredentialAdmission({
        db,
        localCellId: dataCellExecutionFence.localCell,
      }),
      routeTarget:
        env.GOOGLE_PROVIDER_ENDPOINT_PROFILE === 'local-sandbox'
          ? {
              kind: 'local_sandbox',
              simulatorOrigin: new URL(providerEndpoints.gbpApiBaseUrl).origin,
            }
          : { kind: 'production' },
      admit: async ({ authorization, admission }) => {
        const binding = googleContentRuntimeBindings[authorization.capability]
        if (!binding) return { ok: false, code: 'runtime_unavailable' }
        const result = await googleContentAuthority!.admit({
          runtimeBinding: binding,
          scope: {
            organizationId: authorization.organizationId,
            propertyId: authorization.propertyId,
            connectionId: authorization.connectionId,
            initiatorUserId: authorization.initiatorUserId,
            ...(authorization.capability === 'property.publish_reply'
              ? { publication: authorization.publication }
              : {}),
          },
          expectedApprovalBindingId: authorization.approvalBindingId,
          expectedAuthorizationVector: authorization.authorizationVector,
          operationKey: `provider.${admission.routeKey}`,
          routeKey: admission.routeKey,
          routeCatalogVersion: admission.catalogueVersion,
          quotaPolicyId: admission.quotaPolicyId,
          providerRequestBinding: {
            requestBindingSha256: admission.requestBindingSha256,
            credentialBinding: admission.credentialBinding,
            projectFingerprint: binding.googleProjectAttestationSha256,
            requestBodySha256: admission.requestBodySha256,
            requestBodyBytes: admission.requestBodyBytes,
          },
          startVectorMode: 'full',
          commitVectorMode: 'full',
        })
        return result.ok
          ? { ok: true as const, permitId: result.permit.id }
          : { ok: false as const, code: authorityAdmissionCode(result.code) }
      },
      gateway,
      logger,
    })
  }

  // BQC-1.7: the bounded lifecycle purge implementation is review-owned
  // infrastructure — the composition root is the only layer allowed to
  // import it (CONTEXT.md cross-context rule). LIF-01 severs it from normal
  // Property lifecycle; Integration still uses it for governed disconnect.
  const sourceContentPurge = createSourceContentPurge({ db, clock })

  // BQC-2.7: every path that creates a property grants it the capability
  // allowlist its organization already holds — without it a freshly created
  // property denies every non-core capability (`property_not_allowlisted`)
  // until an operator repairs it. Shared by the manual creation path
  // (property context) and the Google import (integration context).
  const propertyCapabilityProvisioning = bindPropertyCapabilityProvisioning(
    db,
    identity.internal.refreshPolicyStore,
  )

  const property = buildPropertyContext({
    db,
    repo: createPropertyRepository(db, { localCell: env.PROCESSING_CELL }),
    events: eventBus,
    clock,
    idGen: randomUUID,
    localCell: env.PROCESSING_CELL,
    staffPublicApi: staff.publicApi,
    identityManagerFacts: identity.publicApi.managerFacts,
    provisionPropertyCapabilities:
      propertyCapabilityProvisioning.provisionCreatedProperty,
    logger: getLogger(),
    // BQC-4.5: only catalogue-accepting cells can be targets. The Identity
    // audit sink handles typed denial evidence; an accepted request instead
    // uses Property's atomic move+audit adapter. The stepper pauses/drains the
    // cell's property-scoped queues.
    regionMove: {
      writeOperatorAudit: identity.internal.writeOperatorAudit,
      queues: [
        { name: 'default', queue: infra.jobQueue },
        { name: 'background', queue: infra.backgroundQueue },
      ],
    },
  })

  const portal = buildPortalContext({
    db,
    events: eventBus,
    outboxRepo,
    clock,
    propertyApi: property.publicApi,
    staffPublicApi: staff.publicApi,
    identityManagerFacts: identity.publicApi.managerFacts,
    baseUrl: env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    idGen: () => crypto.randomUUID(),
    secureRandomBytes: randomBytes,
    tokenHashSecret: env.PORTAL_TOKEN_HASH_SECRET,
    logger,
    storage: options?.providers?.storage,
    storageConfig: {
      accessKey: env.AWS_S3_ACCESS_KEY ?? '',
      secretKey: env.AWS_S3_SECRET_ACCESS_KEY ?? '',
      bucketName: env.AWS_S3_BUCKET_NAME ?? '',
      region: env.AWS_S3_REGION ?? '',
      internalEndpoint: env.S3_INTERNAL_ENDPOINT,
      presignEndpoint: env.S3_PRESIGN_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
  })

  const guest = buildGuestContext({
    db,
    events: eventBus,
    clock,
    idGen: randomUUID,
    monotonicNow: performance.now.bind(performance),
    portalApi: portal.publicApi.portal,
    identityManagerFacts: identity.publicApi.managerFacts,
    identityAccountAdminAuthority: identity.publicApi.accountAdminAuthority,
    staffApi: staff.publicApi,
    logger,
    storage: portal.internal.storage,
    sessionSecret: env.GUEST_SESSION_SALT,
    publicOrigin: new URL(env.BETTER_AUTH_URL).origin,
    secureCookies: env.NODE_ENV === 'production',
    resolvePrimaryStaffAttribution: staff.publicApi.resolvePrimaryStaffAttribution,
    observationLossRedis: redis,
  })

  const oauthCallbackQuotaCounter: OAuthCallbackQuotaCounter = redis
    ? createRedisOAuthCallbackQuotaCounter(redis)
    : env.NODE_ENV === 'production'
      ? Object.freeze({ consume: async () => false })
      : createInMemoryOAuthCallbackQuotaCounter()
  const oauthCallbackAbuseGate = createOAuthCallbackAbuseGate({
    counter: oauthCallbackQuotaCounter,
    hmacSecret: env.OAUTH_STATE_SECRET,
    projectIdentity: env.GOOGLE_CLIENT_ID,
  })

  const integration = buildIntegrationContext({
    db,
    outboxRepo,
    events: eventBus,
    clock,
    idGen: randomUUID,
    invalidationOwnerGen: () => randomBytes(32).toString('base64url'),
    jobQueue: infra.jobQueue,
    propertyApi: property.publicApi,
    propertyBindingApi: property.publicApi,
    provisionPropertyCapabilities:
      propertyCapabilityProvisioning.provisionCreatedProperty,
    enqueueReviewSync: (data, options) =>
      review.publicApi.syncAdmission.addSyncJob(data, options),
    enqueueTargetedReviewFetch: (data, options) =>
      review.publicApi.syncAdmission.addTargetedFetchJob(data, options),
    logger: getLogger(),
    providerEndpoints,
    config: {
      nodeEnv: env.NODE_ENV,
      googleClientId: env.GOOGLE_CLIENT_ID,
      googleClientSecret: env.GOOGLE_CLIENT_SECRET,
      encryptionKey: env.ENCRYPTION_KEY,
      authBaseUrl: env.BETTER_AUTH_URL,
      pubsubTopic: env.GBP_PUBSUB_TOPIC,
      pubsubNotificationTypes: env.GBP_PUBSUB_NOTIFICATION_TYPES,
    },
    sourceContentPurge,
    googleOAuth: options?.providers?.googleOAuth,
    gbpApi: options?.providers?.gbpApi,
    googleAuthorizedProviderExecutor,
    googleDisconnectRevokeStore,
    ...(googleAuthorizedProviderExecutor ? { authorizeGoogleOAuthProviderCall } : {}),
    googleImportReplayKeys,
    authorizeGoogleImportContent,
    authorizeGooglePerformanceContent,
    authorizeGoogleReviewSyncContent,
    authorizeGoogleReplyPublicationContent,
    googlePerformancePrincipalKeys,
    providerAuthorizationLeases,
    googleImportReferences,
    providerEphemeralStore,
    googleOpaqueReferenceKeys,
    googleReviewCursorStore: options?.providers?.googleReviewCursorStore,
    oauthStateHandles,
    oauthCallbackAbuseGate,
    refreshPolicyStoreRequired: identity.internal.refreshPolicyStoreRequired,
    googleRefreshCoordination,
    localDataCellId: dataCellExecutionFence.localCell,
    admitPropertyExecution: dataCellExecutionFence.decideProperty,
    // Fail closed on ungoverned provider egress in production. The review
    // adapter's direct-`fetch` fallback is reachable merely by leaving the
    // GOOGLE_EGRESS_* values unset, and it bypasses admission, quota control,
    // credential binding and mTLS. Outside production this is a no-op.
    assertDirectProviderEgressAllowed: (operation) =>
      assertDirectProviderEgressAllowed(env, operation),
    assertDirectCredentialEgressAllowed: (operation) =>
      assertDirectCredentialEgressAllowed(env, operation),
  })

  const aiRuntime = createAiRuntimeProviders({
    env,
    runtimeEnvironment: process.env,
    enableJobs,
    inferenceOverride: options?.providers?.aiInference,
    subjectHmacOverride: options?.providers?.aiSubjectHmac,
  })
  const review = buildReviewContext({
    db,
    events: eventBus,
    outboxRepo,
    clock,
    idGen: randomUUID,
    snapshotRunIdGen: randomUUID,
    staffPublicApi: staff.publicApi,
    publicationActorAuthority: async (tx, authorityInput) =>
      (await identity.internal.decidePublicationActorAuthority(tx, authorityInput))
        .allowed,
    googleReviewApi: integration.internal.googleReviewApi,
    targetedReviewReferences: integration.internal.googleReviewPushTargetResolver,
    jobQueue: infra.jobQueue,
    workerRuntime: {
      pool,
      registry: infra.jobRegistry,
      backgroundQueue: infra.backgroundQueue,
    },
    logger: getLogger(),
    // effect; the property context owns the routing fact (ADR 0048).
    propertyApi: property.publicApi,
    // BQC-4.2: stamp the content-free routing envelope at enqueue (telemetry;
    // the worker's dispatch-time routing gate re-resolves and decides).
    processingRouter,
    providerSubjectKeyring: reviewProviderSubjectKeyring,
    aiReplyProvenancePublicKeys: aiRuntime.provenancePublicKeys,
    replyBrandProfiles: portal.publicApi.portal,
  })
  const ai = buildAiContext({
    db,
    outboxRepo,
    redis,
    idGen: randomUUID,
    nowEpochMillis: () => clock().getTime(),
    reviewSources: review.publicApi.aiReviewSource,
    propertyReplyLanguages: {
      readDefaultReplyLanguage: ({ organizationId: orgId, propertyId: pid }) =>
        property.publicApi.getPropertyReplyLanguage(orgId, pid),
    },
    replyBrandProfiles: portal.publicApi.portal,
    inference: aiRuntime.inference,
    subjectHmac: aiRuntime.subjectHmac,
    enqueuePropertyTrend: infra.jobQueue
      ? async (scheduleId) => {
          await infra.jobQueue!.add(
            GENERATE_PROPERTY_TREND_JOB_NAME,
            { scheduleId },
            {
              jobId: `ai-trend-${scheduleId}`,
              ...jobEnqueueOptions(GENERATE_PROPERTY_TREND_JOB_NAME),
              removeOnComplete: true,
              removeOnFail: { count: 50 },
            },
          )
        }
      : undefined,
  })

  const inbox = buildInboxContext({
    db,
    events: eventBus,
    clock,
    idGen: randomUUID,
    cutoverState: (family) =>
      resolveCutoverState(family, {
        DURABLE_CUTOVER_INBOX: env.DURABLE_CUTOVER_INBOX,
        DURABLE_CUTOVER_INBOX_REVIEW_CREATED: env.DURABLE_CUTOVER_INBOX_REVIEW_CREATED,
        DURABLE_CUTOVER_INBOX_REVIEW_UPDATED: env.DURABLE_CUTOVER_INBOX_REVIEW_UPDATED,
        DURABLE_CUTOVER_INBOX_REVIEW_EXPIRED: env.DURABLE_CUTOVER_INBOX_REVIEW_EXPIRED,
        DURABLE_CUTOVER_INBOX_REVIEW_REPLY_PUBLISHED:
          env.DURABLE_CUTOVER_INBOX_REVIEW_REPLY_PUBLISHED,
      }),
    staffPublicApi: staff.publicApi,
    authorizeCommand: createInboxCommandAuthority({
      decideManagerPropertyAuthorities:
        identity.internal.decideManagerPropertyAuthorities,
      decideUserParticipationAuthority: staff.internal.decideUserParticipationAuthority,
    }),
    // BQC-1.4: review.publicApi IS the governed read interface — it satisfies
    // the inbox ReviewLookupPort and metric ReviewRatingLookupPort directly.
    // No per-context eligibility adapters remain (single rule, one owner).
    reviewLookup: review.publicApi,
    aiInsights: {
      readCurrentReviewAnalysis: async (request) => {
        const current = await review.publicApi.aiReviewSource.readCurrentSource({
          organizationId: request.organizationId,
          reviewId: request.reviewId,
        })
        if (
          current.status === 'not_found' ||
          current.source.propertyId !== request.propertyId
        ) {
          return { status: 'none' } as const
        }
        return ai.publicApi.readReviewAnalysis({
          ...request,
          sourceEpoch: current.source.sourceEpoch,
          sourceRevision: current.source.sourceRevision,
          analysisSequence: current.source.analysisSequence,
        })
      },
      findCurrentReviewIdsByAttention: ai.publicApi.findCurrentReviewIdsByAttention,
      findCurrentReviewIdsByCategory: ai.publicApi.findCurrentReviewIdsByCategory,
    },
    // Foreign read sources the inbox build adapts into its lookup ports.
    sources: {
      // Feedback spans two storage generations: the guest_responses aggregate
      // that the live guest form writes, and the legacy feedback/ratings pair.
      // `guest.feedback.submitted` carries the aggregate row id, so the
      // aggregate read is what makes a new feedback inbox item render at all —
      // the legacy lookup cannot resolve that id.
      feedback: {
        findResponseSnippetsByIds: async (ids, orgId) =>
          (
            await guest.internal.repos.guestResponseRepo.findSnippetsForOrg(orgId, ids)
          ).map((row) => ({ ...row, id: feedbackId(row.id) })),
        findEligibleResponseIds: async (orgId, filter) =>
          (
            await guest.internal.repos.guestResponseRepo.findEligibleSnippetIdsForOrg(
              orgId,
              filter,
            )
          ).map(feedbackId),
        findLegacyFeedbackSnippetsByIds: (ids, orgId) =>
          guest.internal.repos.guestRepo.findFeedbackSnippetsByIds(ids, orgId),
        findEligibleLegacyFeedbackIds: (orgId, filter) =>
          guest.internal.repos.guestRepo.findEligibleFeedbackIds(orgId, filter),
      },
      property: property.publicApi,
      reply: review.internal.repos.replyRepo,
      review: review.internal.repos.reviewRepo,
      replyObservationAuthority: review.publicApi.replyObservationAuthority,
      responseTargetAuthority: review.publicApi.responseTargetAuthority,
      sourceTransitionAuthority: review.publicApi.sourceTransitionAuthority,
    },
    logger: getLogger(),
  })
  const { releaseDueResponseTargetReminders } = inbox.internal.useCases

  releaseMemberAuthorities = async (orgId, userIdValue, actorId) => {
    const at = clock()
    const [propertyRelease, portalRelease] = await Promise.all([
      property.internal.repos.responsibleManagerRepo.releaseForUser({
        organizationId: orgId,
        userId: userIdValue,
        at,
        endReason: 'manager_offboarded',
      }),
      portal.internal.repos.portalResponsibleManagerRepo.releaseForUser({
        organizationId: orgId,
        userId: userIdValue,
        at,
        endReason: 'manager_offboarded',
      }),
      inbox.internal.commandStore.releaseAssignmentsForUser({
        organizationId: organizationId(orgId),
        userId: userId(userIdValue),
        actorId: actorId ? userId(actorId) : null,
        at,
      }),
    ])
    await identity.internal.revokeAllPropertyAccessForUser(orgId, userIdValue)
    for (const event of [
      ...propertyRelease.responsibilityNeededEvents,
      ...portalRelease.responsibilityNeededEvents,
    ]) {
      await eventBus.emit(event)
    }
  }

  reconcileResponsibleManagerEligibility = async (orgId, userIdValue, actorId) => {
    const [propertyAssignments, portalAssignments] = await Promise.all([
      property.internal.repos.responsibleManagerRepo.listActiveForUser(
        orgId,
        userIdValue,
      ),
      portal.internal.repos.portalResponsibleManagerRepo.listActiveForUser(
        orgId,
        userIdValue,
      ),
    ])
    const assignedPropertyIds = [
      ...new Set([
        ...propertyAssignments.map((assignment) => assignment.propertyId),
        ...portalAssignments.map((assignment) => assignment.propertyId),
      ]),
    ]
    const eligibility = new Map(
      await Promise.all(
        assignedPropertyIds.map(
          async (assignedPropertyId) =>
            [
              assignedPropertyId,
              await isEligibleResponsibleManager(
                {
                  listActiveManagers: identity.publicApi.managerFacts.listActiveManagers,
                  getAccessiblePropertyIds: staff.publicApi.getAccessiblePropertyIds,
                  findActiveParticipation: async (organizationIdValue, pid, managerId) =>
                    staff.publicApi.findActiveParticipation?.(
                      organizationIdValue,
                      pid,
                      managerId,
                    ) ?? null,
                },
                organizationId(orgId),
                propertyId(assignedPropertyId),
                userIdValue,
              ),
            ] as const,
        ),
      ),
    )
    const propertyIdsToRelease = propertyAssignments
      .filter((assignment) => eligibility.get(assignment.propertyId) === false)
      .map((assignment) => assignment.propertyId)
    const portalIdsToRelease = portalAssignments
      .filter((assignment) => eligibility.get(assignment.propertyId) === false)
      .map((assignment) => assignment.portalId)
    const at = clock()
    const [propertyRelease, portalRelease] = await Promise.all([
      property.internal.repos.responsibleManagerRepo.releaseForUser({
        organizationId: orgId,
        userId: userIdValue,
        propertyIds: propertyIdsToRelease,
        at,
        endReason: 'manager_became_ineligible',
      }),
      portal.internal.repos.portalResponsibleManagerRepo.releaseForUser({
        organizationId: orgId,
        userId: userIdValue,
        portalIds: portalIdsToRelease,
        at,
        endReason: 'manager_became_ineligible',
      }),
      // Assignment is operational metadata, never an authority. Inbox
      // re-proves each review/feedback requirement in its own transaction and
      // durably clears only the properties that are no longer eligible.
      inbox.internal.commandStore.releaseIneligibleAssignmentsForUser({
        organizationId: organizationId(orgId),
        userId: userId(userIdValue),
        actorId: userId(actorId),
        at,
      }),
    ])
    for (const event of [
      ...propertyRelease.responsibilityNeededEvents,
      ...portalRelease.responsibilityNeededEvents,
    ]) {
      await eventBus.emit(event)
    }
  }

  const metricApi = buildMetricContext({
    db,
    events: eventBus,
    clock,
    idGen: randomUUID,
    logger,
    portalGroupApi: portal.publicApi.portalGroup,
    portalApi: portal.publicApi.portal,
    reviewRatingLookup: review.publicApi,
  })

  const authorizeGoalCorrectionScope =
    createScheduledScopeAuthorizer('system:goal.maintain')
  const goalCorrectionPolicy = {
    authorize: async (request: {
      actor: unknown
      organizationId: string
      propertyId: string
      action: string
    }): Promise<void> => {
      if (
        request.actor !== 'system' ||
        request.action !== 'goal.update' ||
        !(await authorizeGoalCorrectionScope(request.organizationId, request.propertyId))
      ) {
        throw new Error('Goal metric-correction reconciliation is not authorized')
      }
    },
  } as const

  // Goal context — only canonical GoalProgram/result authority is composed.
  const goal = buildGoalContext({
    db,
    metricApi: metricApi.publicApi,
    clock,
    propertyApi: property.publicApi,
    idGen: () => crypto.randomUUID(),
    portalGroupApi: portal.publicApi.portalGroup,
    portalApi: portal.publicApi.portal,
  })

  // ── Dashboard context (facade ports per ADR-0007) ────────────────
  // Review content and Portal analytics cross owner-governed serving APIs.
  // Dashboard retains only the explicitly tracked legacy property/fleet
  // projection adapters pending the remaining MET-01 cutover.
  const dashboard = buildDashboardContext({
    db,
    staffPublicApi: staff.publicApi,
    clock,
    reviewServingStats: review.internal.servingStats,
    guestResponseIntegrity: guest.publicApi,
    portalMetrics: metricApi.publicApi.portalAnalytics,
    portalLifetime: metricApi.publicApi.portalLifetime,
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
    idGen: () => recentActivityEntryId(crypto.randomUUID()),
    operationalHistoryIdGen: () => operationalActionHistoryRecordId(crypto.randomUUID()),
    operationalHistoryHoldIdGen: () => crypto.randomUUID(),
    operationalHistoryAccessAuthority: identity.publicApi.accountAdminAuthority,
  })

  // ── Notification context ──────────────────────────────────────────
  const notification = buildNotificationContext({
    db,
    events: eventBus,
    outboxRepo,
    queue: infra.jobQueue,
    clock,
    idGen: randomUUID,
    logger,
    responsibleManagers: {
      findForProperty: (orgId, pid) =>
        property.publicApi.getResponsibleManagerUserIds(orgId, pid),
      findForPortal: (orgId, pid) =>
        portal.publicApi.portal.getResponsibleManagerUserIds(orgId, pid),
      findForPortalGroup: async (orgId, groupId) => {
        const portalIds = await portal.publicApi.portalGroup.getGroupPortalIds(
          orgId,
          groupId,
        )
        const recipients = await Promise.all(
          portalIds.map((pid) =>
            portal.publicApi.portal.getResponsibleManagerUserIds(orgId, pid),
          ),
        )
        return [...new Set(recipients.flat())]
      },
      isEligibleForProperty: (orgId, pid, managerId) =>
        property.publicApi.isEligibleResponsibleManagerUserId(orgId, pid, managerId),
    },
    feedbackPortalLookup: {
      findPortalId: (orgId, sourceId) =>
        guest.publicApi.findPortalIdForFeedback(orgId, sourceId),
    },
    googleConnectionProperties: {
      findGoogleNotificationAnchor: (connectionIdValue, orgId) =>
        property.publicApi.findGoogleNotificationAnchor(connectionIdValue, orgId),
    },
    monthlyResultFacts: {
      findMonthlyResultNotificationFacts:
        goal.publicApi.findMonthlyResultNotificationFacts,
      findMonthlyResultRevisionNotificationFacts:
        goal.publicApi.findMonthlyResultRevisionNotificationFacts,
    },
    portalHealthLookup: {
      findPortalHealthNotificationFacts:
        portal.publicApi.portal.findPortalHealthNotificationFacts,
    },
  })

  // ── Operations snapshot (BQC-5.5) ─────────────────────────────────
  // The ONE governed operational read interface. Ops queue read handles
  // (domain-events + quarantine — worker-owned write side) are opened ONCE
  // here, read-only, one Redis connection per queue per process; the
  // /api/health/metrics route and the health-check job both consume these —
  // no per-request or per-module duplicates.
  const opsQueues = {
    background:
      options?.opsBackgroundQueue ??
      infra.backgroundQueue ??
      (redis ? createJobQueue('background') : undefined),
    domainEvents:
      options?.opsDomainEventsQueue ??
      (redis ? createJobQueue('domain-events') : undefined),
    quarantine:
      options?.opsQuarantineQueue ??
      (redis ? createJobQueue(QUARANTINE_QUEUE_NAME) : undefined),
  } as const
  const runtimeObservationQueue = opsQueues.background ?? infra.jobQueue
  const jobRuntimeObservationStore =
    runtimeObservationQueue && 'client' in runtimeObservationQueue
      ? createQueueJobRuntimeObservationStore({
          queue: runtimeObservationQueue as JobRuntimeQueueRedisSource,
          cell: env.PROCESSING_CELL,
        })
      : null
  const jobRuntimeReport = jobRuntimeObservationStore
    ? createJobRuntimeReportReader({
        contracts: JOB_OPERATIONAL_CONTRACTS,
        store: jobRuntimeObservationStore,
        queues: {
          default: infra.jobQueue ?? null,
          background: opsQueues.background ?? null,
        },
        quarantine: opsQueues.quarantine ?? null,
        clock,
      })
    : null
  // ARC-03-T6: registered in release order. Identity's persisted policy store
  // starts a POLICY_REFRESH_INTERVAL_MS poller while the container is being
  // built; without this hook the interval outlives every shutdown path.
  const containerShutdown: ContainerShutdown = createContainerShutdown(
    [
      {
        label: 'identity-policy-store-poller',
        release: identity.internal.stopPolicyPolling,
      },
    ],
    logger,
  )
  const operationsSnapshot = createOperationsSnapshot({
    db,
    outboxRepo,
    queues: {
      default: infra.jobQueue ?? null,
      background: opsQueues.background ?? null,
      domainEvents: opsQueues.domainEvents ?? null,
      quarantine: opsQueues.quarantine ?? null,
    },
    redis: redis ?? null,
    clock,
    // BQC-7.3: version identity — the root reads the constants (the shared
    // zone cannot import context domain).
    versions: {
      capabilityPolicy: CAPABILITY_POLICY_VERSION,
      executionPolicy: EXECUTION_POLICY_VERSION,
      policyStore: identity.internal.policyStoreVersion,
      routingPolicy: ROUTING_POLICY_VERSION,
      sourceContentPolicy: createGoogleSourceContentPolicy().policyVersion,
    },
    // notification.missing_for_inbox_item: the query is the notification
    // context's, the gauge is the shared health snapshot's — the root is the
    // only place allowed to join them.
    readMissingNotificationCount: notification.publicApi.readMissingNotificationCount,
    readNotificationDeliveryLag: notification.publicApi.readNotificationDeliveryLag,
    readGuestObservationLoss: () =>
      guest.internal.repos.guestObservationLossMonitor.read(clock()),
    ...(jobRuntimeReport ? { jobRuntime: jobRuntimeReport } : {}),
  })

  return {
    betaFeedbackTriageRepo,
    db,
    pool,
    logger,
    idGen: randomUUID,
    redis,
    eventBus,
    outboxRepo,
    clock,
    opsQueues,
    operationsSnapshot,
    guestContactRequestRetentionSweep:
      guest.internal.contactRequestReadiness.retentionSweep,
    dataCellExecutionFence,
    aiPublicApi: ai.publicApi,
    aiWorkerRuntime: ai.worker,
    // BQC-7.4: the alert dispatch port — composition-owned so the
    // health-check job (and any future evaluation point) shares the ONE
    // dispatcher (error-level ALERT log + optional ALERT_WEBHOOK_URL POST).
    alertDispatcher: createAlertDispatcher({
      logger,
      clock,
      webhookUrl: env.ALERT_WEBHOOK_URL,
    }),
    // ARC-03-T6: the container's owned release seam. Everything a build()
    // starts for the life of the process registers here, so the web
    // graceful-shutdown plugin, the worker drain and closeContainer() all stop
    // the same resources through one capability instead of leaking them.
    shutdown: containerShutdown,
    // ARC-03-T8: the policy trio this container owns. Constructing it installs
    // nothing process-wide — an entry point calls bindProcessPolicies(container)
    // exactly once, so a second container can never silently take over.
    capabilityPolicyStore: identity.internal.capabilityPolicyStore,
    executionPolicy: identity.internal.executionPolicy,
    delayedExecutionPolicy: identity.internal.delayedExecutionPolicy,
    cache: infra.cache,
    rateLimiter: infra.rateLimiter,
    jobQueue: infra.jobQueue,
    backgroundQueue: infra.backgroundQueue,
    jobRegistry: infra.jobRegistry,
    /** Shared issued-object capability used by Identity profile assets and
     * Portal media. The name exposes the port's purpose, not its adapter. */
    assetStorage: portal.internal.storage,
    portalWorkerRuntime: Object.freeze({
      storage: portal.internal.storage,
      uploadStore: portal.internal.repos.portalUploadStore,
      revalidateApprovedDestinations: portal.worker.revalidateApprovedDestinations,
    }),
    /** Operator-only Review repair and lifecycle authority. */
    reviewMaintenanceRuntime: review.maintenance,
    ...(options?.exposeSimulationRuntime
      ? {
          /** Narrow scenario/invariant capabilities, absent from normal app
           * containers even though they share the same deterministic builder. */
          simulationRuntime: Object.freeze({
            review: Object.freeze({
              upsert: (
                ...args: Parameters<typeof review.internal.repos.reviewRepo.upsert>
              ) => review.internal.repos.reviewRepo.upsert(...args),
              findByOrganizationId: (
                ...args: Parameters<
                  typeof review.internal.repos.reviewRepo.findByOrganizationId
                >
              ) => review.internal.repos.reviewRepo.findByOrganizationId(...args),
            }),
            reply: Object.freeze({
              findByReviewId: (
                ...args: Parameters<typeof review.internal.repos.replyRepo.findByReviewId>
              ) => review.internal.repos.replyRepo.findByReviewId(...args),
            }),
            inbox: Object.freeze({
              findBySource: (
                ...args: Parameters<typeof inbox.internal.repos.inboxRepo.findBySource>
              ) => inbox.internal.repos.inboxRepo.findBySource(...args),
            }),
          }),
        }
      : {}),
    providerEphemeralReadiness,
    identityPublicApi: identity.publicApi,
    identityWorkerRuntime: identity.worker,
    integrationPublicApi: integration.publicApi,
    integrationWorkerRuntime: integration.worker,
    integrationMaintenanceRuntime: integration.maintenance,
    integrationLifecycleRuntime: integration.lifecycle,
    integrationWebhookRuntime: integration.webhook,
    propertyPublicApi: property.publicApi,
    reviewPublicApi: review.publicApi,
    staffPublicApi: staff.publicApi,
    identityLifecycleRuntime: identity.internal.organizationLifecycleRuntime,
    guestPublicApi: guest.publicApi,
    inboxPublicApi: inbox.publicApi,
    /** Cross-context Inbox workflow authority; no request or repair surface. */
    inboxLifecycleRuntime: inbox.lifecycle,
    /** Bounded, operator-only Inbox projection repair authority. */
    inboxMaintenanceRuntime: inbox.maintenance,
    inboxRuntime: Object.freeze({
      releaseDueResponseTargetReminders,
    }),
    metricPublicApi: metricApi.publicApi,
    metricMaintenanceRuntime: metricApi.maintenance,
    dashboardPublicApi: dashboard.publicApi,
    goalPublicApi: goal.publicApi,
    goalWorkerRuntime: goal.worker,
    activityPublicApi: activity.publicApi,
    activityWorkerRuntime: Object.freeze({
      recentActivityRepo: activity.internal.repos.recentActivityRepo,
    }),
    notificationPublicApi: notification.publicApi,
    identityPort,
    // Request-scoped Identity handlers consume only their parsed, semantic
    // key material. They never re-read process configuration after boot.
    identityRequestSecurity: Object.freeze({
      invitationRateLimitHmacSecret: env.BETTER_AUTH_SECRET,
      betaFeedbackHmacSecret: env.BETTER_AUTH_SECRET,
    }),
    // BQC-2.7: least-privilege policy administration operations.
    policyAdmin: identity.internal.policyAdmin,
    portalPublicApi: portal.publicApi,
    notificationWorkerRuntime: Object.freeze({
      notificationRepo: notification.internal.repos.notificationRepo,
      emailRepo: notification.internal.repos.emailRepo,
      preferenceRepo: notification.internal.repos.prefRepo,
    }),
    handleResendEvent: notification.internal.handleResendEvent,
    notificationAudienceAuthorizer: notification.internal.authorizeAudience,
    // The notification-gap healing sweep (registered by bootstrap on the
    // worker path). Undefined when no job queue exists.
    reconcileMissingNotificationsHandler:
      notification.internal.reconcileMissingNotificationsHandler,
    // BQC-2.2: version-gated strong read of persisted policy state.
    // Workers await this before starting; side-effect paths use it for
    // fresh reads (BQC-2.5). Owned by the identity build (readiness).
    refreshPolicyStore: identity.internal.refreshPolicyStore,
    // `providerSubjectKeys` is always a service — the real keyring-backed one
    // when the writer material is configured, otherwise the secret-free deny
    // adapter whose acquireDeriver() throws `config_invalid`. So this IS the
    // boot-time inventory-parity check: it verifies the decoded worker key set
    // against the database's masked inventory before any job runs. The
    // env-level precondition is enforced earlier, at container construction
    // (assertReviewProviderSubjectKeysConfigured).
    refreshReviewProviderSubjectKeys: async () => {
      await review.internal.providerSubjectKeys.acquireDeriver()
    },
    registerReviewWorkerJobs: ({
      reviewDiscoveryIntervalMs,
    }: {
      reviewDiscoveryIntervalMs: number
    }) =>
      review.internal.registerWorkerJobs({
        discoveryIntervalMs: reviewDiscoveryIntervalMs,
      }),
    /** ARC-03-T7: the durable consumer registry this container owns. */
    consumerRegistry,
    // Worker-only durable consumer registration contributed by owning contexts.
    // Every context registers into THIS container's registry.
    registerOutboxConsumers: () => {
      integration.worker.registerOutboxConsumers(consumerRegistry)
      review.worker.registerOutboxConsumers(consumerRegistry)
      portal.worker.registerOutboxConsumers(consumerRegistry)
      property.worker.registerOutboxConsumers(consumerRegistry)
      inbox.worker.registerOutboxConsumers(consumerRegistry)
      metricApi.worker.registerOutboxConsumers(consumerRegistry)
      goal.worker.registerOutboxConsumers(consumerRegistry, goalCorrectionPolicy)
      ai.worker.registerOutboxConsumers(consumerRegistry)
      activity.worker.registerOutboxConsumers(consumerRegistry)
      notification.worker.registerOutboxConsumers(consumerRegistry)
    },
    providerEphemeralRedis,
  } as const
}

type BuiltContainer = ReturnType<typeof createContainer>
/** Production/application container type. Simulation write authority is not
 * representable here, even as an optional property. */
export type Container = Omit<BuiltContainer, 'simulationRuntime'>
export type SimulationContainer = BuiltContainer & {
  simulationRuntime: NonNullable<BuiltContainer['simulationRuntime']>
}

// BQC-7.1: the production build bundles this module twice (nitro app chunk +
// lazy SSR chunk) — a module-level singleton would give each copy its own
// container (and its own BullMQ queue connections). The Symbol.for key
// shares one container process-wide so the graceful-shutdown plugin closes
// the queues the request path actually created.
const CONTAINER_KEY = Symbol.for('repkey.composition.container')
type ContainerStore = { [CONTAINER_KEY]?: Container }

function containerStore(): ContainerStore {
  return globalThis as ContainerStore
}

/** Get or create the singleton container. */
export function getContainer(): Container {
  const store = containerStore()
  if (!store[CONTAINER_KEY]) {
    store[CONTAINER_KEY] = createContainer()
  }
  return store[CONTAINER_KEY]
}

/**
 * Close the singleton container's owned queue connections (BQC-7.1 graceful
 * shutdown). Only the getContainer() singleton is affected — containers built
 * directly via createContainer() (worker process, simulations, tests) own
 * their lifecycle. BullMQ queues hold dedicated Redis connections that would
 * otherwise keep the web process's event loop alive past SIGTERM; BullMQ
 * treats user-supplied connections as shared and does not close them on
 * queue.close(), so the tracked connections are quit explicitly after the
 * queues detach. No-op when the container was never built; resets the
 * singleton so a later getContainer() recreates it.
 */
export async function closeContainer(): Promise<void> {
  const store = containerStore()
  const container = store[CONTAINER_KEY]
  store[CONTAINER_KEY] = undefined
  if (!container) return
  // ARC-03-T6: release container-owned background work FIRST. The policy
  // poller re-reads the database on every tick, so stopping it before the
  // connections go away is what keeps shutdown quiet instead of logging a
  // refresh failure against a closing pool. Optional because the singleton is
  // keyed by Symbol.for and shared across the two composition bundles the
  // production build emits — an older bundle's container may predate the seam.
  await container.shutdown?.run()
  await Promise.all([
    container.jobQueue?.close(),
    container.backgroundQueue?.close(),
    container.providerEphemeralRedis?.quit(),
  ])
  await closeJobQueueConnections()
}

/**
 * ARC-03-T8: make the singleton container's policy trio the process answer.
 *
 * Binding is idempotent for the same container and throws for a different one,
 * so a simulation, an operator command's own policy boot, or a second
 * container can no longer silently take the process over — which is exactly
 * what building a container used to do.
 *
 * Each long-lived process names its installation point: the worker binds the
 * container it builds (src/worker/index.ts), the operator harness binds its
 * minimal policy boot (scripts/ops/operator-command.ts), and the web process
 * binds through the cold-boot fallback registered below.
 */
export function bindProcessPoliciesFromSingleton(): void {
  bindProcessPolicies(getContainer())
}

// Cold-boot fallback for the WEB process — one named registration, no policy
// installation. A policy check can run before any getContainer() call in a
// fresh process (requireExecutionAllowed precedes the server function's own
// getContainer; historically the first dashboard load after a dev-server
// restart failed with "[EXECUTION POLICY] not initialized"), so the first
// policy read binds the root on demand.
//
// WHY it lives here rather than in a process entry file: this is the only
// server-side module loaded in BOTH the vite dev SSR runtime and the built
// server before the first gated request. Nitro plugins do not execute under
// vite dev, and src/start.ts is an import-protection graph entry for the
// client environment where '**/composition.ts' is denied. What changed is
// that the installation itself now goes through the single guarded owner
// (bindProcessPolicies) instead of two raw singleton writes.
registerProcessPolicyColdBoot(bindProcessPoliciesFromSingleton)
