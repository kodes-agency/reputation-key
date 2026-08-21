// Composition root — selects the enabled context modules and supplies the
// cross-context adapters and true root scalars. This is the only place where
// the full container is built. Both server and worker build it and use it.
//
// Each context's build.ts owns its internal wiring (repos, adapters, use
// cases, event handlers) and exposes only what composition needs: the
// server/application interface (publicApi + internal), plus readiness/runtime
// contributions where required (identity: refreshPolicyStore; inbox:
// registerOutboxConsumers) and the optional shutdown hook (none today).
// The root does NOT import individual use cases, event handlers, or business
// rules. Worker/job/consumer/schedule registration is owned by BQC-3
// (bootstrap.ts + worker/) — the root consumes that runtime registry as one
// accepted interface and never introduces another.
//
// Per architecture: "No DI framework, no auto-wiring, no decorators.
// Dependencies are passed as function arguments. The wiring is in composition.ts, visible."

import { getDb } from '#/shared/db'
import type { Database } from '#/shared/db'
import { getLogger } from '#/shared/observability/logger'
import { getRedis } from '#/shared/cache/redis'
import { createEventBus } from '#/shared/events/event-bus'
import type { EventBus } from '#/shared/events/event-bus'
import {
  createBusAuthorizer,
  createScheduledScopeAuthorizer,
} from '#/shared/jobs/delayed-execution-gate'
import { createRedisCache } from '#/shared/cache/redis-cache'
import { createNoopCache } from '#/shared/cache/noop-cache'
import type { Cache } from '#/shared/cache/cache.port'
import { createRateLimiter } from '#/shared/rate-limit/middleware'
import type { RateLimiter } from '#/shared/rate-limit/middleware'
import { createJobQueue, closeJobQueueConnections } from '#/shared/jobs/queue'
import { createJobRegistry } from '#/shared/jobs/registry'
import type { JobRegistry } from '#/shared/jobs/registry'
import { QUARANTINE_QUEUE_NAME } from '#/shared/jobs/failure-quarantine'
import { createOperationsSnapshot } from '#/shared/health/operations-snapshot'
import { createAlertDispatcher } from '#/shared/observability/alert-dispatcher'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createBetterAuthIdentityAdapter } from '#/contexts/identity/infrastructure/adapters/auth-identity.adapter'
import { createGrantAccessLookup } from '#/contexts/identity/infrastructure/adapters/grant-access-lookup.adapter'
import { registerExecutionPolicyInit } from '#/shared/auth/execution-policy'
import { registerDelayedExecutionPolicyInit } from '#/shared/auth/system-execution-policy'
import type { IdentityPort } from '#/contexts/identity/application/ports/identity.port'
import type { GoogleOAuthPort } from '#/contexts/integration/application/ports/google-oauth.port'
import type { GbpApiPort } from '#/contexts/integration/application/ports/gbp-api.port'
import type { GoogleAuthorizedProviderExecutor } from '#/contexts/integration/application/ports/google-authorized-provider-executor.port'
import type { GoogleImportReferenceStore } from '#/contexts/integration/application/ports/google-import-reference-store.port'
import type { GoogleImportContentAuthorizer } from '#/contexts/integration/application/google-import-command-authorizer'
import { createGoogleContentAuthorizationCheck } from '#/contexts/integration/infrastructure/google-content-authorization-check'
import {
  authorityAdmissionCode,
  createGoogleAuthorizedProviderExecutor,
} from '#/contexts/integration/infrastructure/adapters/google-authorized-provider-executor.adapter'
import { createOpaqueImportReferenceStore } from '#/contexts/integration/infrastructure/opaque-import-reference-store'
import type { GoogleReviewCursorStore } from '#/contexts/integration/infrastructure/google-review-cursor-store'
import { createGoogleCredentialBinder } from '#/shared/google-provider-control/credential-binding'
import { createGoogleEgressGatewayHttpClient } from '../services/google-egress-gateway/http-api'
import {
  createInternalMtlsJsonTransport,
  loadInternalMtlsMaterial,
  loadInternalMtlsMaterialFromBase64,
} from '../services/internal-mtls'
import { createGoogleContentAuthorityRepository } from '#/contexts/identity/infrastructure/repositories/google-content-authority.repository'
import {
  createPropertyCapabilityProvisioning,
  type PropertyCapabilityProvisioning,
} from '#/contexts/identity/application/use-cases/policy-admin'
import {
  getPropertyOrganizationId,
  listOrganizationCapabilities,
  listPropertyCapabilities,
  listProvisionablePropertyIds,
  provisionPropertyCapabilitiesFromOrganization,
} from '#/contexts/identity/infrastructure/repositories/policy-state.repository'
import { createGoogleContentAuthorizationAuthority } from '#/shared/auth/google-content-authority'
import {
  createGoogleContentRoleSignatureVerifier,
  parseGoogleContentRolePublicKeys,
} from '#/shared/auth/google-content-approval'
import { parseGoogleContentRuntimeBindings } from '#/shared/auth/google-content-runtime-bindings'
import type { PerformanceContentAuthorizer } from '#/contexts/integration/application/google-performance-authorizer'
import type { StoragePort } from '#/contexts/portal/application/ports/storage.port'
import { buildIdentityContext } from '#/contexts/identity/build'
import { CAPABILITY_POLICY_VERSION } from '#/shared/auth/beta-capabilities'
import { EXECUTION_POLICY_VERSION } from '#/shared/auth/execution-policy'
import { ROUTING_POLICY_VERSION } from '#/contexts/property/domain/processing-routing'
import { createGoogleSourceContentPolicy } from '#/shared/domain/source-content-policy'
import {
  getAuth,
  setMembershipRemovalLifecycle,
  setOnAcceptInvitation,
  INVITATION_EXPIRY_SECONDS,
} from '#/shared/auth/auth'
import { sendInvitationEmail } from '#/shared/auth/emails'
import { headersFromContext } from '#/shared/auth/headers'
import { getEnv, getReleaseSha } from '#/shared/config/env'
import type { Env } from '#/shared/config/env'
import {
  assertDirectProviderEgressAllowed,
  assertReviewProviderSubjectKeysConfigured,
} from '#/shared/config/provider-config-guards'
import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Clock } from '#/shared/domain/clock'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { buildPropertyContext } from '#/contexts/property/build'
import { createPropertyRepository } from '#/contexts/property/infrastructure/repositories/property.repository'
import { createPropertyRoutingLoader } from '#/contexts/property/infrastructure/property-routing.adapter'
import { createPropertyRegionLoader } from '#/contexts/property/infrastructure/property-region-loader'
import { createProcessingRouter } from '#/shared/routing/processing-router'
import { providerRefForCell } from '#/shared/routing/processing-router'
import type { ProviderEndpoints } from '#/shared/routing/processing-router'
import { buildIntegrationContext } from '#/contexts/integration/build'
import { createImportItemRoutingLoader } from '#/contexts/integration/infrastructure/import-item-routing.adapter'
import { createOAuthStateHandleService } from '#/contexts/integration/application/oauth-state-handle'
import {
  createVersionedHmacKeyring,
  type VersionedHmacKeyring,
} from '#/shared/security/versioned-hmac-keyring'
import type { ProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import { createRedisProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import { createProviderEphemeralRedis } from '#/shared/provider-ephemeral/redis-client'
import { createInMemoryProviderEphemeralStore } from '#/shared/provider-ephemeral/in-memory-store'
import {
  createProviderAuthorizationLeaseService,
  type ProviderAuthorizationLeaseService,
} from '#/shared/provider-ephemeral/authorization-lease'
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
import { buildTeamContext } from '#/contexts/team/build'
import { buildStaffContext } from '#/contexts/staff/build'
import { buildPortalContext } from '#/contexts/portal/build'
import { buildGuestContext } from '#/contexts/guest/build'
import { buildReviewContext } from '#/contexts/review/build'
import { createSourceContentPurge } from '#/contexts/review/infrastructure/source-content-purge'
import { configureReviewProviderSubjectWriterKeys } from '#/contexts/review/application/provider-subject-keyring'
import { buildInboxContext } from '#/contexts/inbox/build'
import { buildMetricContext } from '#/contexts/metric/build'
import { buildBadgeContext } from '#/contexts/badge/build'
import { buildLeaderboardContext } from '#/contexts/leaderboard/build'
import { buildDashboardContext } from '#/contexts/dashboard/build'
import { buildGoalContext } from '#/contexts/goal/build'
import { buildActivityContext } from '#/contexts/activity/build'
import { buildNotificationContext } from '#/contexts/notification/build'
import { createStaffAssignmentRepository } from '#/contexts/staff/infrastructure/repositories/staff-assignment.repository'
import { buildAiContext } from '#/contexts/ai/build'
import { GENERATE_PROPERTY_TREND_JOB_NAME } from '#/contexts/ai/infrastructure/jobs/generate-property-trend.job'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import type { AiInferencePort } from '#/contexts/ai/application/ports/ai-inference.port'
import type { AiSubjectHmacPort } from '#/contexts/ai/application/ports/ai-subject-hmac.port'
import { createAiGatewayAdapter } from '#/contexts/ai/infrastructure/adapters/ai-gateway.adapter'
import { createAiSubjectHmacAdapter } from '#/contexts/ai/infrastructure/adapters/ai-subject-hmac.adapter'
import { loadNamedEd25519PublicKeyring } from '#/shared/ed25519-key-material'
import {
  assertAiAdmissionPublicKeyringInventory,
  assertAiProvenancePublicKeyringInventory,
  resolveAiGatewayRuntimeKeyInventory,
} from '#/shared/ai-gateway-key-inventory'
import { AI_INTERNAL_RESPONSE_MAX_BYTES } from '#/shared/ai-internal-transport-contract'
import type { AiGatewayCaller } from '#/shared/ai-gateway-transport-contract'
import { createIdentityMembershipAdapter } from '#/contexts/staff/infrastructure/adapters/identity-membership.adapter'

// ── Infrastructure ─────────────────────────────────────────────────

function buildInfrastructure(options: {
  redis: Redis | undefined
  enableJobs: boolean
  /** Override the queue (simulations inject an in-memory queue). */
  queue?: Queue
  /** Override the background queue (simulations inject an in-memory queue). */
  backgroundQueue?: Queue
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
  return { cache, rateLimiter, jobQueue, backgroundQueue, jobRegistry }
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
    gbpAccountManagementBaseUrl: 'https://mybusinessaccountmanagement.googleapis.com/v1',
    gbpPerformanceBaseUrl: 'https://businessprofileperformance.googleapis.com/v1',
    reviewsApiBaseUrl: 'https://mybusiness.googleapis.com/v4',
    notificationsApiBaseUrl: 'https://mybusinessnotifications.googleapis.com/v1',
    oauthTokenUrl: 'https://oauth2.googleapis.com/token',
    oauthJwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
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

/**
 * BQC-6.5: operator sandbox seam. Explicit per-endpoint env overrides applied
 * ONCE at container build on top of the cell's approved provider endpoints.
 * A sandbox deployment can point the REAL adapters at a provider stub/sandbox
 * (e.g. GBP_API_BASE_URL=http://localhost:4100) without touching code. Every
 * override absent = the resolved endpoints pass through byte-identical — this
 * function changes nothing unless an operator explicitly set a variable.
 */
export function applyProviderEndpointOverrides(
  endpoints: ProviderEndpoints,
  env: Env,
): ProviderEndpoints {
  const overrides = [
    env.GBP_API_BASE_URL,
    env.GBP_ACCOUNT_MANAGEMENT_BASE_URL,
    env.GBP_PERFORMANCE_BASE_URL,
    env.GBP_REVIEWS_API_BASE_URL,
    env.GBP_NOTIFICATIONS_API_BASE_URL,
    env.GOOGLE_OAUTH_TOKEN_URL,
    env.GOOGLE_OAUTH_JWKS_URL,
    env.GOOGLE_OAUTH_REVOKE_URL,
  ]
  if (
    env.NODE_ENV === 'production' &&
    env.GOOGLE_PROVIDER_ENDPOINT_PROFILE !== 'local-sandbox' &&
    overrides.some((value) => value !== undefined)
  ) {
    throw new Error(
      'provider endpoint overrides require the attested local-sandbox profile',
    )
  }
  return {
    gbpApiBaseUrl: env.GBP_API_BASE_URL ?? endpoints.gbpApiBaseUrl,
    gbpAccountManagementBaseUrl:
      env.GBP_ACCOUNT_MANAGEMENT_BASE_URL ?? endpoints.gbpAccountManagementBaseUrl,
    gbpPerformanceBaseUrl:
      env.GBP_PERFORMANCE_BASE_URL ?? endpoints.gbpPerformanceBaseUrl,
    reviewsApiBaseUrl: env.GBP_REVIEWS_API_BASE_URL ?? endpoints.reviewsApiBaseUrl,
    notificationsApiBaseUrl:
      env.GBP_NOTIFICATIONS_API_BASE_URL ?? endpoints.notificationsApiBaseUrl,
    oauthTokenUrl: env.GOOGLE_OAUTH_TOKEN_URL ?? endpoints.oauthTokenUrl,
    oauthJwksUrl: env.GOOGLE_OAUTH_JWKS_URL ?? endpoints.oauthJwksUrl,
    oauthRevokeUrl: env.GOOGLE_OAUTH_REVOKE_URL ?? endpoints.oauthRevokeUrl,
  }
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
    logger.warn({ err: e }, 'Failed to set active organization during setup')
  }
}

// ── Main container ─────────────────────────────────────────────────

/** BQC-6.1: deterministic external provider adapters by injection. When a
 * slot is absent the context build constructs the real env-driven adapter —
 * defaults are byte-identical to the pre-slot behavior (additive change). */
export type ProviderOverrides = Readonly<{
  /** Google OAuth adapter (integration context). */
  googleOAuth?: GoogleOAuthPort
  /** Google Business Profile API adapter (integration context). */
  gbpApi?: GbpApiPort
  /** Authorized Google provider execution seam (local acceptance/tests). */
  googleAuthorizedProviderExecutor?: GoogleAuthorizedProviderExecutor
  /** Opaque import reference store backed by provider-ephemeral storage. */
  googleImportReferences?: GoogleImportReferenceStore
  /** Opaque Review paging cursor store backed by provider-ephemeral storage. */
  googleReviewCursorStore?: GoogleReviewCursorStore
  /** Fresh Google Content approval/kill authorization seam. */
  authorizeGoogleImportContent?: GoogleImportContentAuthorizer
  /** Fresh approval/kill authorization for live Performance reads. */
  authorizeGooglePerformanceContent?: PerformanceContentAuthorizer
  /** Principal-binding keyring for volatile Performance authorization leases. */
  googlePerformancePrincipalKeys?: VersionedHmacKeyring
  /** Provider-ephemeral Performance lease service. */
  providerAuthorizationLeases?: ProviderAuthorizationLeaseService
  /** AI egress inference adapter (deterministic tests/simulations). */
  aiInference?: AiInferencePort
  /** Worker-only keyed pseudonym authority for AI operations. */
  aiSubjectHmac?: AiSubjectHmacPort
  /** Object storage adapter (portal context). */
  storage?: StoragePort
}>

function createAiRuntimeProviders(
  input: Readonly<{
    env: Env
    enableJobs: boolean
    inferenceOverride?: AiInferencePort
    subjectHmacOverride?: AiSubjectHmacPort
  }>,
): Readonly<{
  inference?: AiInferencePort
  subjectHmac?: AiSubjectHmacPort
  provenancePublicKeys?: ReturnType<typeof loadNamedEd25519PublicKeyring>
}> {
  const keyInventory = resolveAiGatewayRuntimeKeyInventory({
    ...process.env,
    AI_KEY_INVENTORY_PROFILE: input.env.AI_KEY_INVENTORY_PROFILE,
  })
  const gatewayConfig = [
    input.env.AI_EGRESS_GATEWAY_ORIGIN,
    input.env.AI_EGRESS_GATEWAY_SERVER_NAME,
    input.env.AI_INTERNAL_MTLS_CA_B64,
    input.env.AI_INTERNAL_MTLS_CERT_B64,
    input.env.AI_INTERNAL_MTLS_KEY_B64,
    input.env.AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON,
  ] as const
  const configured = gatewayConfig.filter((value): value is string => value !== undefined)
  if (configured.length !== 0 && configured.length !== gatewayConfig.length) {
    throw new Error('AI egress gateway transport configuration is incomplete')
  }
  if (!input.enableJobs && input.env.AI_SUBJECT_HMAC_KEYS !== undefined) {
    throw new Error('AI subject HMAC authority is worker-only')
  }

  // The gateway pins a client certificate route per caller, so the runtime
  // flag becomes a peer identity exactly here: jobs-enabled is the worker,
  // every other container is the web app.
  const caller: AiGatewayCaller = input.enableJobs ? 'worker' : 'web'

  let inference = input.inferenceOverride
  if (!inference && configured.length > 0) {
    const [origin, serverName, ca, cert, key, publicKeysJson] = configured
    const publicKeys = loadNamedEd25519PublicKeyring(
      publicKeysJson,
      [
        keyInventory.admissionSigning.activeKid,
        ...keyInventory.admissionSigning.retainedKids,
      ],
      keyInventory.admissionSigning.maximumConfiguredKeys,
    )
    assertAiAdmissionPublicKeyringInventory(publicKeys, keyInventory)
    inference = createAiGatewayAdapter({
      transport: createInternalMtlsJsonTransport({
        origin,
        serverName,
        tls: loadInternalMtlsMaterialFromBase64({ ca, cert, key }),
        peerIdentityPolicy: {
          uri: 'spiffe://repkey.internal/ai-egress-gateway',
          dnsName: serverName,
          extendedKeyUsages: ['serverAuth', 'clientAuth'],
        },
        timeoutMs: 105_000,
        maxResponseBytes: AI_INTERNAL_RESPONSE_MAX_BYTES,
      }),
      caller,
      admissionSettlementPublicKeys: publicKeys,
    })
  }

  const provenancePublicKeys = input.env.AI_PROVENANCE_ED25519_PUBLIC_KEYS_JSON
    ? loadNamedEd25519PublicKeyring(
        input.env.AI_PROVENANCE_ED25519_PUBLIC_KEYS_JSON,
        [keyInventory.provenance.activeKid],
        keyInventory.provenance.maximumPrivateKeysPerProcess,
      )
    : undefined
  if (provenancePublicKeys) {
    assertAiProvenancePublicKeyringInventory(provenancePublicKeys, keyInventory)
  } else if (!input.enableJobs && configured.length > 0) {
    throw new Error('AI provenance public keyring is unavailable')
  }

  const subjectHmac =
    input.subjectHmacOverride ??
    (input.env.AI_SUBJECT_HMAC_KEYS
      ? createAiSubjectHmacAdapter(input.env.AI_SUBJECT_HMAC_KEYS)
      : undefined)
  if (input.enableJobs && inference !== undefined && subjectHmac === undefined) {
    throw new Error('AI worker subject HMAC authority is unavailable')
  }
  return Object.freeze({ inference, subjectHmac, provenancePublicKeys })
}

/**
 * BQC-2.7 property capability provisioning, bound to identity's persistence.
 *
 * A property created by the Google import (and any property imported before
 * this wiring existed) starts with an EMPTY property_capability set, and an
 * empty set denies every non-core capability (`property_not_allowlisted`).
 * This binding grants a property its organization's allowlist idempotently.
 *
 * Exported because scripts/ is wiring-only: ops:property-capabilities binds
 * the same provisioning against the running container.
 */
export function bindPropertyCapabilityProvisioning(
  db: Database,
  refreshPolicy: () => Promise<void>,
): PropertyCapabilityProvisioning {
  return createPropertyCapabilityProvisioning({
    listOrganizationCapabilities: (orgId) => listOrganizationCapabilities(db, orgId),
    listPropertyCapabilities: (propId) => listPropertyCapabilities(db, propId),
    getPropertyOrganizationId: (propId) => getPropertyOrganizationId(db, propId),
    listProvisionablePropertyIds: (orgId) => listProvisionablePropertyIds(db, orgId),
    provisionPropertyCapabilities: (input) =>
      provisionPropertyCapabilitiesFromOrganization(db, input),
    refreshPolicy,
  })
}

// Accepted residual (BQC-5.2/BQC-5.7): per-dependency override pattern is
// inherently branchy; extraction would scatter the wiring. Owner: BQC-5.2.
// fallow-ignore-next-line complexity
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
  /** Override the ops domain-events read handle (simulations/tests inject an
   * in-memory queue — the real one opens a dedicated Redis connection). */
  opsDomainEventsQueue?: Queue
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

  // Infrastructure
  const infra = buildInfrastructure({
    redis,
    enableJobs,
    queue: options?.queue,
    backgroundQueue: options?.backgroundQueue,
  })

  // Identity port (adapter)
  const identityPort = options?.identityPort ?? createBetterAuthIdentityAdapter(db)

  // BQC-4.2: the ONE routing decision model — shared by the review context
  // (enqueue envelope stamping) and the BQC-4.4 operator region diagnostic.
  const processingRouter = createProcessingRouter({
    loadPropertyRouting: createPropertyRoutingLoader({ db }),
    loadImportItemRouting: createImportItemRoutingLoader({ db }),
    cell: env.PROCESSING_CELL,
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
      providerRef: providerRefForCell(env.PROCESSING_CELL) ?? null,
    },
    cancelGoogleImportsForUser: (orgId, userIdValue) => {
      const cancel = integration.internal.useCases.cancelGoogleImportV2ForUser
      if (!cancel) throw new Error('Google import lifecycle unavailable')
      return cancel(orgId, userIdValue).then(() => undefined)
    },
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
    (providerEphemeralStore && googleOpaqueReferenceKeys && providerAuthorizationLeases
      ? createOpaqueImportReferenceStore({
          store: providerEphemeralStore,
          handleKeys: googleOpaqueReferenceKeys,
          leasePrincipalKeys: googleOpaqueReferenceKeys,
          leases: providerAuthorizationLeases,
          nowMs: () => clock().getTime(),
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

  const gatewayConfig = [
    env.GOOGLE_EGRESS_GATEWAY_ORIGIN,
    env.GOOGLE_EGRESS_GATEWAY_SERVER_NAME,
    env.GOOGLE_INTERNAL_MTLS_CA_PATH,
    env.GOOGLE_INTERNAL_MTLS_CERT_PATH,
    env.GOOGLE_INTERNAL_MTLS_KEY_PATH,
    env.GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS,
  ] as const
  const configuredGatewayValues = gatewayConfig.filter(
    (value): value is string => value !== undefined,
  )
  if (
    configuredGatewayValues.length !== 0 &&
    configuredGatewayValues.length !== gatewayConfig.length
  ) {
    throw new Error('Google egress gateway transport configuration is incomplete')
  }
  let googleAuthorizedProviderExecutor =
    options?.providers?.googleAuthorizedProviderExecutor
  if (!googleAuthorizedProviderExecutor && configuredGatewayValues.length > 0) {
    if (!googleContentAuthority || !googleContentRuntimeBindings) {
      throw new Error('Google egress gateway requires Google Content runtime approval')
    }
    const [
      gatewayOrigin,
      gatewayServerName,
      caPath,
      certPath,
      keyPath,
      credentialBindingKeys,
    ] = configuredGatewayValues
    const bindCredential = createGoogleCredentialBinder(
      createVersionedHmacKeyring(credentialBindingKeys),
    )
    const gateway = createGoogleEgressGatewayHttpClient(
      createInternalMtlsJsonTransport({
        origin: gatewayOrigin,
        serverName: gatewayServerName,
        tls: loadInternalMtlsMaterial({ caPath, certPath, keyPath }),
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
  // import it (CONTEXT.md cross-context rule). Constructed ONCE and shared
  // by the property (hard delete) and integration (disconnect) builds.
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
    repo: createPropertyRepository(db),
    events: eventBus,
    clock,
    staffPublicApi: staff.publicApi,
    sourceContentPurge,
    provisionPropertyCapabilities:
      propertyCapabilityProvisioning.provisionCreatedProperty,
    logger: getLogger(),
    // BQC-4.5: region move workflow. Approved cells stay {'us'} (ADR 0048) —
    // every real request denies typed + audited today. The audit sink is the
    // identity-owned policy_decision_audit (content-free, operator kind),
    // exposed by the identity build for injection; the stepper pauses/drains
    // the cell's property-scoped queues.
    regionMove: {
      writeOperatorAudit: identity.internal.writeOperatorAudit,
      queues: [
        { name: 'default', queue: infra.jobQueue },
        { name: 'background', queue: infra.backgroundQueue },
      ],
    },
    googleImportLifecycle: {
      prepareDeletion: async (orgId, propertyIdValue) => {
        const prepare =
          integration.internal.useCases.prepareGoogleImportV2PropertyDeletion
        if (!prepare) throw new Error('Google import lifecycle unavailable')
        const result = await prepare(orgId, propertyIdValue)
        return { itemIds: result.itemIds }
      },
      finalizeDeletion: async (orgId, itemIds) => {
        const finalize =
          integration.internal.useCases.finalizeGoogleImportV2PropertyDeletion
        if (!finalize) throw new Error('Google import lifecycle unavailable')
        await finalize(orgId, itemIds)
      },
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
    tokenHashSecret: env.PORTAL_TOKEN_HASH_SECRET,
    queue: infra.jobQueue,
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
    outboxRepo,
    clock,
    portalApi: portal.publicApi.portal,
    logger,
    storage: portal.internal.storage,
    sessionSecret: env.GUEST_SESSION_SALT,
    secureCookies: env.NODE_ENV === 'production',
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
    events: eventBus,
    clock,
    jobQueue: infra.jobQueue,
    propertyApi: property.publicApi,
    propertyBindingApi: property.bindingApi,
    provisionPropertyCapabilities:
      propertyCapabilityProvisioning.provisionCreatedProperty,
    enqueueReviewSync: (data, options) =>
      review.internal.repos.queue.addSyncJob(data, options),
    logger: getLogger(),
    providerEndpoints,
    sourceContentPurge,
    googleOAuth: options?.providers?.googleOAuth,
    gbpApi: options?.providers?.gbpApi,
    googleAuthorizedProviderExecutor,
    googleImportReplayKeys,
    authorizeGoogleImportContent,
    authorizeGooglePerformanceContent,
    googlePerformancePrincipalKeys,
    providerAuthorizationLeases,
    googleImportReferences,
    providerEphemeralStore,
    googleOpaqueReferenceKeys,
    googleReviewCursorStore: options?.providers?.googleReviewCursorStore,
    oauthStateHandles,
    oauthCallbackAbuseGate,
    refreshPolicyStoreRequired: identity.internal.refreshPolicyStoreRequired,
    // Fail closed on ungoverned provider egress in production. The review
    // adapter's direct-`fetch` fallback is reachable merely by leaving the
    // GOOGLE_EGRESS_* values unset, and it bypasses admission, quota control,
    // credential binding and mTLS. Outside production this is a no-op.
    assertDirectProviderEgressAllowed: (operation) =>
      assertDirectProviderEgressAllowed(env, operation),
  })

  setMembershipRemovalLifecycle({
    beforeRemoveMember: async (orgId, userIdValue) => {
      const cancel = integration.internal.useCases.cancelGoogleImportV2ForUser
      if (!cancel) throw new Error('Google import lifecycle unavailable')
      await cancel(orgId, userIdValue)
    },
    beforeDeleteOrganization: async (orgId) => {
      const cancel = integration.internal.useCases.cancelGoogleImportV2ForOrganization
      if (!cancel) throw new Error('Google import lifecycle unavailable')
      await cancel(orgId)
    },
  })

  const aiRuntime = createAiRuntimeProviders({
    env,
    enableJobs,
    inferenceOverride: options?.providers?.aiInference,
    subjectHmacOverride: options?.providers?.aiSubjectHmac,
  })
  const review = buildReviewContext({
    db,
    events: eventBus,
    clock,
    staffPublicApi: staff.publicApi,
    googleReviewApi: integration.internal.googleReviewApi,
    jobQueue: infra.jobQueue,
    logger: getLogger(),
    // effect; the property context owns the routing fact (ADR 0048).
    propertyApi: property.publicApi,
    // BQC-4.2: stamp the content-free routing envelope at enqueue (telemetry;
    // the worker's dispatch-time routing gate re-resolves and decides).
    processingRouter,
    providerSubjectKeyring: reviewProviderSubjectKeyring,
    aiReplyProvenancePublicKeys: aiRuntime.provenancePublicKeys,
  })
  const ai = buildAiContext({
    db,
    redis,
    reviewSources: review.internal.aiReviewSource,
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
    staffPublicApi: staff.publicApi,
    // BQC-1.4: review.publicApi IS the governed read interface — it satisfies
    // the inbox ReviewLookupPort and metric ReviewRatingLookupPort directly.
    // No per-context eligibility adapters remain (single rule, one owner).
    reviewLookup: review.publicApi,
    aiInsights: {
      readCurrentReviewAnalysis: async (request) => {
        const current = await review.internal.repos.reviewRepo.findById(
          request.reviewId,
          request.organizationId,
        )
        if (!current || current.propertyId !== request.propertyId) {
          return { status: 'none' } as const
        }
        return ai.publicApi.readReviewAnalysis({
          ...request,
          sourceEpoch: current.sourceEpoch,
          sourceRevision: current.sourceRevision,
          analysisSequence: current.analysisSequence,
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
        findResponseSnippetById: (id, orgId) =>
          guest.internal.repos.guestResponseRepo.findSnippetForOrg(orgId, id),
        findFeedbackById: (id, orgId) =>
          guest.internal.repos.guestRepo.findFeedbackById(id, orgId),
        findRatingById: (id, orgId) =>
          guest.internal.repos.guestRepo.findRatingById(id, orgId),
      },
      property: property.publicApi,
      reply: review.internal.repos.replyRepo,
      review: review.internal.repos.reviewRepo,
    },
    logger: getLogger(),
  })

  const metricApi = buildMetricContext({
    db,
    events: eventBus,
    clock,
    portalGroupApi: portal.publicApi.portalGroup,
    portalApi: portal.publicApi.portal,
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
    propertyApi: property.publicApi,
    idGen: () => crypto.randomUUID(),
    getLogger,
    portalGroupApi: portal.publicApi.portalGroup,
  })

  // ── Dashboard context (facade ports per ADR-0007) ────────────────
  // Dashboard never queries review/reply/metric tables directly. BQC-5.5:
  // review-content reads cross the review-owned governed serving interface
  // (eligibility enforced at the owner, ADR 0031); the dashboard build
  // constructs only its remaining direct-read SQL adapters internally.
  const dashboard = buildDashboardContext({
    db,
    staffPublicApi: staff.publicApi,
    clock,
    reviewServingStats: review.internal.servingStats,
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
    authorizeReconciliationScope: createScheduledScopeAuthorizer(
      'system:badge.reconcile',
    ),
  })

  const leaderboard = buildLeaderboardContext({
    db,
    events: eventBus,
    outboxRepo,
    clock,
    propertyApi: property.publicApi,
    authorizeBoardReconciliationScope: createScheduledScopeAuthorizer(
      'system:leaderboard.reconcile',
    ),
    authorizeAwardReconciliationScope: createScheduledScopeAuthorizer(
      'system:badge.reconcile',
    ),
  })

  // ── Notification context ──────────────────────────────────────────
  const notification = buildNotificationContext({
    db,
    events: eventBus,
    outboxRepo,
    queue: infra.jobQueue,
    clock,
    logger,
    propertyAccessHolders: identity.internal.propertyAccessHolders,
  })

  // ── Wire invitation acceptance lifecycle ─────────────────────────
  // PropertyAccessGrant is the sole authorization input; participation is
  // separate attribution/profile state. The post-commit hook provisions both
  // idempotently and never writes the legacy staff_assignments table.
  setOnAcceptInvitation(async ({ userId, organizationId, propertyIds, displayName }) => {
    for (const rawPropertyId of propertyIds) {
      try {
        await identity.internal.grantInvitationPropertyAccess({
          userId,
          organizationId,
          propertyId: rawPropertyId,
        })
        await staff.internal.systemStaffParticipation({
          userId,
          organizationId,
          propertyId: rawPropertyId,
          displayName,
        })
      } catch (error) {
        logger.warn(
          { err: error },
          'Failed to provision invited property access and participation',
        )
      }
    }
  })
  // ── Operations snapshot (BQC-5.5) ─────────────────────────────────
  // The ONE governed operational read interface. Ops queue read handles
  // (domain-events + quarantine — worker-owned write side) are opened ONCE
  // here, read-only, one Redis connection per queue per process; the
  // /api/health/metrics route and the health-check job both consume these —
  // no per-request or per-module duplicates.
  const opsQueues = {
    domainEvents:
      options?.opsDomainEventsQueue ??
      (redis ? createJobQueue('domain-events') : undefined),
    quarantine:
      options?.opsQuarantineQueue ??
      (redis ? createJobQueue(QUARANTINE_QUEUE_NAME) : undefined),
  } as const
  const operationsSnapshot = createOperationsSnapshot({
    db,
    outboxRepo,
    queues: {
      default: infra.jobQueue ?? null,
      background: infra.backgroundQueue ?? null,
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
  })

  return {
    db,
    logger,
    redis,
    eventBus,
    outboxRepo,
    clock,
    opsQueues,
    operationsSnapshot,
    ai: ai.internal,
    // BQC-7.4: the alert dispatch port — composition-owned so the
    // health-check job (and any future evaluation point) shares the ONE
    // dispatcher (error-level ALERT log + optional ALERT_WEBHOOK_URL POST).
    alertDispatcher: createAlertDispatcher({
      logger,
      clock,
      webhookUrl: env.ALERT_WEBHOOK_URL,
    }),
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
      handleGbpNotification: integration.internal.gbpNotificationHandler({
        reviewQueue: review.internal.repos.queue,
      }),
      runReviewProviderSnapshot: review.internal.useCases.runReviewProviderSnapshot,
      draftReply: review.internal.useCases.draftReply,
      submitReply: review.internal.useCases.submitReply,
      approveReply: review.internal.useCases.approveReply,
      editPublishedReply: review.internal.useCases.editPublishedReply,
      rejectReply: review.internal.useCases.rejectReply,
      deleteReply: review.internal.useCases.deleteReply,
      getReply: review.internal.useCases.getReply,
      retryPublish: review.internal.useCases.retryPublish,
      reconcileReplyPublication: review.internal.useCases.reconcileReplyPublication,
      getStaffRecentActivity: review.internal.useCases.getStaffRecentActivity,
      generateReplySuggestion: ai.publicApi.generateReplySuggestion,
      generatePropertyTrend: ai.internal.generatePropertyTrend,
      schedulePropertyTrends: ai.internal.schedulePropertyTrends,
      readPropertyAiTrend: ai.publicApi.readPropertyTrend,
      readPropertyAiAggregates: ai.publicApi.readPropertyAggregates,
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
    providerEphemeralReadiness,
    replyRepo: review.internal.repos.replyRepo,
    badgePublicApi: badge.publicApi,
    leaderboardPublicApi: leaderboard.publicApi,
    reviewQueue: review.internal.repos.queue,
    replyQueue: review.internal.repos.replyQueue,
    googleReviewApi: integration.internal.googleReviewApi,
    staffPublicApi: staff.publicApi,
    propertyProcessingScopeApi: property.publicApi,
    inboxRepo: inbox.internal.repos.inboxRepo,
    inboxNoteRepo: inbox.internal.repos.inboxNoteRepo,
    goalRepo: goal.internal.repos.goalRepo,
    metricPublicApi: metricApi.publicApi,
    activityPublicApi: activity.publicApi,
    activityRepo: activity.internal.repos.activityRepo,
    notificationPublicApi: notification.publicApi,
    identityPort,
    // BQC-2.7: least-privilege policy administration operations.
    policyAdmin: identity.internal.policyAdmin,
    portalPublicApi: portal.publicApi,
    notificationRepo: notification.internal.repos.notificationRepo,
    notificationEmailRepo: notification.internal.repos.emailRepo,
    notificationPrefRepo: notification.internal.repos.prefRepo,
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
    // Worker-only durable consumer registration contributed by owning contexts.
    registerOutboxConsumers: () => {
      integration.internal.registerOutboxConsumers()
      property.internal.registerOutboxConsumers()
      inbox.internal.registerOutboxConsumers()
      metricApi.internal.registerOutboxConsumers()
      ai.internal.registerOutboxConsumers()
      notification.internal.registerOutboxConsumers()
    },
    providerEphemeralRedis,
  } as const
}

export type Container = ReturnType<typeof createContainer>

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
  await Promise.all([
    container.jobQueue?.close(),
    container.backgroundQueue?.close(),
    container.providerEphemeralRedis?.quit(),
  ])
  await closeJobQueueConnections()
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
