// Composition root — the only place a full container is built. It SELECTS
// implementations and configuration rather than being one.
//
// Each context's build.ts owns its private wiring and exposes only NAMED
// CAPABILITY GROUPS (docs/standards.md 3.1). ARC-03-T11/T12: the root reads no
// context's private hatch — the single exception is the simulation runtime,
// guarded by its option and absent from every application container. The root
// imports no individual use case, event handler or business rule; job/consumer
// registration stays owned by BQC-3 (bootstrap.ts + worker/). Cohesive
// sub-graphs live in src/composition/, and the per-deployable projections that
// bound what each process may hold live in its deployables module.
//
// Per architecture: "No DI framework, no auto-wiring, no decorators.
// Dependencies are passed as function arguments. The wiring is in composition.ts, visible."

import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import { getLogger } from '#/shared/observability/logger'
import { getRedis } from '#/shared/cache/redis'
import { closeJobQueueConnections } from '#/shared/jobs/queue'
import { createEventBus } from '#/shared/events/event-bus'
import { createBusAuthorizer } from '#/shared/jobs/delayed-execution-gate'
import { createAlertDispatcher } from '#/shared/observability/alert-dispatcher'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { createConsumerRegistry } from '#/shared/outbox'
import { resolveCutoverState } from '#/shared/outbox/cutover-flags'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createBetterAuthIdentityAdapter } from '#/contexts/identity/infrastructure/adapters/auth-identity.adapter'
import { createTanstackRequestContext } from '#/shared/auth/tanstack-request-context'
import { createBetterAuthSessionPort } from '#/shared/auth/better-auth-session'
import { createGrantAccessLookup } from '#/contexts/identity/infrastructure/adapters/grant-access-lookup.adapter'
import { BetaFeedbackTriageRepository } from '#/contexts/identity/infrastructure/beta-feedback-triage.repository'
import {
  bindProcessPolicies,
  registerProcessPolicyColdBoot,
} from '#/shared/auth/process-policy-binding'
import {
  buildIdentityContext,
  createInvitationPropertyAccessProvisioner,
} from '#/contexts/identity/build'
import { INVITATION_EXPIRY_SECONDS } from '#/shared/auth/auth'
import { sendInvitationEmail } from '#/shared/auth/emails'
import { getEnv, getReleaseSha } from '#/shared/config/env'
import {
  assertDirectCredentialEgressAllowed,
  assertDirectProviderEgressAllowed,
  assertReviewProviderSubjectKeysConfigured,
} from '#/shared/config/provider-config-guards'
import { feedbackId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import { buildPropertyContext } from '#/contexts/property/build'
import { createInboxCommandAuthority } from '#/contexts/inbox/infrastructure/adapters/inbox-command-authority.adapter'
import { createPropertyRepository } from '#/contexts/property/infrastructure/repositories/property.repository'
import { createPropertyRoutingLoader } from '#/contexts/property/infrastructure/property-routing.adapter'
import {
  createProcessingRouter,
  providerRefForCell,
} from '#/shared/routing/processing-router'
import { createDataCellExecutionFence } from '#/shared/routing/data-cell-execution-fence'
import { parseGoogleCredentialBrokerRuntimeConfig } from '#/shared/routing/google-credential-broker-runtime'
import { buildIntegrationContext } from '#/contexts/integration/build'
import { createImportItemRoutingLoader } from '#/contexts/integration/infrastructure/import-item-routing.adapter'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { validateGoogleRuntimeIsolationReadiness } from '#/shared/auth/google-runtime-isolation'
import {
  createInMemoryOAuthCallbackQuotaCounter,
  createOAuthCallbackAbuseGate,
  type OAuthCallbackQuotaCounter,
} from '#/contexts/integration/application/oauth-callback-abuse-gate'
import { createRedisOAuthCallbackQuotaCounter } from '#/contexts/integration/infrastructure/oauth-callback-quota-counter'
import { buildStaffContext } from '#/contexts/staff/build'
import { buildPortalContext } from '#/contexts/portal/build'
import { buildGuestContext } from '#/contexts/guest/build'
import { buildReviewContext } from '#/contexts/review/build'
import { createSourceContentPurge } from '#/contexts/review/infrastructure/source-content-purge'
import { configureReviewProviderSubjectWriterKeys } from '#/contexts/review/application/provider-subject-keyring'
import { buildInboxContext } from '#/contexts/inbox/build'
import { buildAiContext } from '#/contexts/ai/build'
import { GENERATE_PROPERTY_TREND_JOB_NAME } from '#/contexts/ai/infrastructure/jobs/generate-property-trend.job'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import {
  applyProviderEndpointOverrides,
  createAiRuntimeProviders,
  providerConfigFor,
} from './composition/provider-runtime'
import { buildInfrastructure } from './composition/infrastructure'
import { buildReadAndNotifyContexts } from './composition/read-and-notify-contexts'
import type { CreateContainerOptions } from './composition/container-options'
import { buildOperationalReadout } from './composition/operational-readout'
import { reportAlertToObservability } from './composition/alert-reporter'
import { composeOrganizationLifecycle } from '#/composition/organization-export-contributors'
import { buildGoogleProviderAuthority } from './composition/google-provider-authority'
import { buildIdentityPolicyDeps } from './composition/identity-policy'
import { bindPropertyCapabilityProvisioning } from './composition/property-capability-provisioning'
import {
  createDeferredMemberAuthorityLifecycle,
  createMemberAuthorityLifecycle,
} from './composition/member-authority-lifecycle'
import {
  claimDeployable,
  projectContainer,
  releaseDeployableClaim,
  type WebContainer,
} from './composition/container-partition'

export {
  applyProviderEndpointOverrides,
  providerConfigFor,
  type ProviderOverrides,
} from './composition/provider-runtime'
export { bindPropertyCapabilityProvisioning } from './composition/property-capability-provisioning'

// fallow-ignore-next-line complexity
function buildContainer(
  options: CreateContainerOptions | undefined,
  mode: 'required' | 'refusing',
) {
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
  // ARC-03-T13: the framework/provider seam is selected HERE and injected
  // everywhere else. No context and no other root line calls getRequest() or
  // the better-auth process singleton.
  const observeAbsentRequest = (err: unknown): void => {
    logger.debug({ err }, 'no server request context available, using empty headers')
  }
  const requestContext =
    options?.requestContext ?? createTanstackRequestContext({ observeAbsentRequest })
  const authSession =
    options?.authSession ?? createBetterAuthSessionPort({ requestContext })
  const identityPort =
    options?.identityPort ??
    createBetterAuthIdentityAdapter(db, {
      clock,
      idGen: randomUUID,
      logger,
      requestContext,
      onAcceptInvitation: invitationPropertyAccessProvisioner,
    })
  // ARC-03-T9: the Identity/Property/Portal/Inbox member-authority seam.
  // Identity is upstream of the three contexts holding the authorities it
  // releases, so the Identity-owned port is handed over now and its
  // implementation is bound once, by name, after those contexts exist.
  // Requests cannot reach the callback until the container finished composing.
  const memberAuthorityLifecycle = createDeferredMemberAuthorityLifecycle()

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
    // repository (ADR 0039).
    accessiblePropertyLookup: createGrantAccessLookup(db, clock),
    clock,
    idGen: randomUUID,
    reconcileResponsibleManagerEligibility:
      memberAuthorityLifecycle.port.reconcileResponsibleManagerEligibility,
  })

  const identity = buildIdentityContext({
    db,
    identityPort,
    events: eventBus,
    clock,
    idGen: randomUUID,
    authSession,
    sendEmail: options?.email ?? sendInvitationEmail,
    baseUrl: env.BETTER_AUTH_URL,
    invitationExpiresInMs: INVITATION_EXPIRY_SECONDS * 1000,
    logger,
    policy: buildIdentityPolicyDeps({
      env,
      db,
      propertyBelongsToOrganization: (orgId, pid) =>
        property.publicApi.propertyExists(organizationId(orgId), propertyId(pid)),
      resolveRouting: (pid) =>
        processingRouter.resolve({ kind: 'property', propertyId: pid }, 'review.sync'),
      admitPropertyExecution: dataCellExecutionFence.decideProperty,
    }),
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
    releaseMemberAuthorities: memberAuthorityLifecycle.port.releaseMemberAuthorities,
    reconcileResponsibleManagerEligibility:
      memberAuthorityLifecycle.port.reconcileResponsibleManagerEligibility,
    organizationLifecycle: composeOrganizationLifecycle(
      db,
      options?.organizationLifecycle,
    ),
  })

  // ARC-03-T10: operators refuse Google; application processes require its substrate.
  const googleProviderAuthority = buildGoogleProviderAuthority({
    db,
    eventBus,
    clock,
    logger,
    env,
    mode,
    redis,
    providerEndpoints,
    dataCellExecutionFence,
    identity: {
      hasActivePropertyGrant: identity.authority.hasActivePropertyGrant,
    },
    ...(options ? { options } : {}),
  })
  const {
    providerEphemeralStore,
    providerEphemeralRedis,
    providerEphemeralReadiness,
    oauthStateHandles,
    googleImportReplayKeys,
    googleOpaqueReferenceKeys,
    googleRefreshCoordination,
    providerAuthorizationLeases,
    googleImportReferences,
    googlePerformancePrincipalKeys,
    authorizeGoogleImportContent,
    authorizeGooglePerformanceContent,
    authorizeGoogleReviewSyncContent,
    authorizeGoogleReplyPublicationContent,
    authorizeGoogleOAuthProviderCall,
    googleDisconnectRevokeStore,
    googleAuthorizedProviderExecutor,
  } = googleProviderAuthority

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
    identity.policy.refresh,
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
      writeOperatorAudit: identity.authority.writeOperatorAudit,
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
    storage: portal.uploads.storage,
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
    refreshPolicyStoreRequired: identity.policy.refreshRequired,
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
    // ARC-03-T14: injectable so a process fixture boots deterministically; the
    // composition boundary is the ONE place allowed to fall back to ambient state.
    runtimeEnvironment: options?.runtimeEnvironment ?? process.env,
    enableJobs,
    pool,
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
      (await identity.authority.decidePublicationActorAuthority(tx, authorityInput))
        .allowed,
    googleReviewApi: integration.reviewSync.googleReviewApi,
    targetedReviewReferences: integration.reviewSync.googleReviewPushTargetResolver,
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
        DURABLE_CUTOVER_INBOX_REVIEW_EXPIRED: env.DURABLE_CUTOVER_INBOX_REVIEW_EXPIRED,
      }),
    staffPublicApi: staff.publicApi,
    authorizeCommand: createInboxCommandAuthority({
      decideManagerPropertyAuthorities:
        identity.authority.decideManagerPropertyAuthorities,
      decideUserParticipationAuthority: staff.authority.decideUserParticipationAuthority,
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
      // ARC-03-T11: read through Guest's named snippet port. The root's only
      // remaining job is the FeedbackId branding both generations share.
      feedback: {
        findResponseSnippetsByIds: async (ids, orgId) =>
          (await guest.snippets.findResponseSnippetsByIds(ids, orgId)).map((row) => ({
            ...row,
            id: feedbackId(row.id),
          })),
        findEligibleResponseIds: async (orgId, filter) =>
          (await guest.snippets.findEligibleResponseIds(orgId, filter)).map(feedbackId),
        findLegacyFeedbackSnippetsByIds: guest.snippets.findLegacyFeedbackSnippetsByIds,
        findEligibleLegacyFeedbackIds: guest.snippets.findEligibleLegacyFeedbackIds,
      },
      property: property.publicApi,
      reply: review.lookups.reply,
      review: review.lookups.review,
      replyObservationAuthority: review.publicApi.replyObservationAuthority,
      responseTargetAuthority: review.publicApi.responseTargetAuthority,
      sourceTransitionAuthority: review.publicApi.sourceTransitionAuthority,
    },
    logger: getLogger(),
  })
  // ARC-03-T9: the member-authority seam's ONE implementation, bound now that
  // Property, Portal and Inbox exist. It consumes named context capabilities,
  // never repositories, and Identity received its port long before this line.
  memberAuthorityLifecycle.provide(
    createMemberAuthorityLifecycle({
      clock,
      propertyResponsibility: property.responsibility,
      portalResponsibility: portal.responsibility,
      inboxAssignments: inbox.assignments,
      propertyAccess: identity.authority,
      emit: (event) => eventBus.emit(event as Parameters<typeof eventBus.emit>[0]),
      eligibility: {
        listActiveManagers: identity.publicApi.managerFacts.listActiveManagers,
        getAccessiblePropertyIds: staff.publicApi.getAccessiblePropertyIds,
        findActiveParticipation: async (organizationIdValue, pid, managerId) =>
          staff.publicApi.findActiveParticipation?.(
            organizationIdValue,
            pid,
            managerId,
          ) ?? null,
      },
    }),
  )

  // ARC-03-T10: the downstream leaf contexts — read models, projections and
  // notifications — composed as one named group.
  const { metricApi, goal, goalCorrectionPolicy, dashboard, activity, notification } =
    buildReadAndNotifyContexts({
      db,
      events: eventBus,
      clock,
      idGen: randomUUID,
      logger,
      outboxRepo,
      jobQueue: infra.jobQueue,
      staff,
      property,
      portal,
      guest,
      review,
      identity,
      inbox,
      reviewServingStats: review.lookups.servingStats,
    })

  // ARC-03-T10/T15: the process's operational readout and release seam.
  const { opsQueues, jobDispatchWorkerRuntime, operationsSnapshot, containerShutdown } =
    buildOperationalReadout({
      db,
      outboxRepo,
      env,
      clock,
      logger,
      redis,
      enableJobs,
      infra,
      processingRouter,
      identity: {
        stopPolicyPolling: identity.policy.stopPolling,
        policyStoreVersion: identity.policy.currentVersion,
      },
      notification: {
        readMissingNotificationCount: notification.publicApi.readMissingNotificationCount,
        readNotificationDeliveryLag: notification.publicApi.readNotificationDeliveryLag,
      },
      guestObservationLoss: guest.observationLoss,
      ...(options ? { overrides: options } : {}),
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
    guestContactRequestRetentionSweep: guest.contactRequestReadiness.retentionSweep,
    dataCellExecutionFence,
    aiPublicApi: ai.publicApi,
    aiWorkerRuntime: ai.worker,
    // BQC-7.4: one composition-owned dispatcher shares the structured log,
    // Sentry reporter, and optional ALERT_WEBHOOK_URL across evaluation points.
    alertDispatcher: createAlertDispatcher({
      logger,
      clock,
      webhookUrl: env.ALERT_WEBHOOK_URL,
      report: reportAlertToObservability,
    }),
    // ARC-03-T6: the container's owned release seam. Everything a build()
    // starts for the life of the process registers here, so the web
    // graceful-shutdown plugin, the worker drain and closeContainer() all stop
    // the same resources through one capability instead of leaking them.
    shutdown: containerShutdown,
    // ARC-03-T8: the policy trio this container owns. Constructing it installs
    // nothing process-wide — an entry point calls bindProcessPolicies(container)
    // exactly once, so a second container can never silently take over.
    capabilityPolicyStore: identity.policy.capabilityPolicyStore,
    executionPolicy: identity.policy.executionPolicy,
    delayedExecutionPolicy: identity.policy.delayedExecutionPolicy,
    cache: infra.cache,
    rateLimiter: infra.rateLimiter,
    jobQueue: infra.jobQueue,
    backgroundQueue: infra.backgroundQueue,
    jobRegistry: infra.jobRegistry,
    jobDispatchWorkerRuntime,
    /** Shared issued-object capability used by Identity profile assets and
     * Portal media. The name exposes the port's purpose, not its adapter. */
    assetStorage: portal.uploads.storage,
    portalWorkerRuntime: Object.freeze({
      storage: portal.uploads.storage,
      uploadStore: portal.uploads.uploadStore,
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
    identityLifecycleRuntime: identity.lifecycle,
    guestPublicApi: guest.publicApi,
    inboxPublicApi: inbox.publicApi,
    /** Cross-context Inbox workflow authority; no request or repair surface. */
    inboxLifecycleRuntime: inbox.lifecycle,
    /** Bounded, operator-only Inbox projection repair authority. */
    inboxMaintenanceRuntime: inbox.maintenance,
    inboxRuntime: inbox.runtime,
    metricPublicApi: metricApi.publicApi,
    metricMaintenanceRuntime: metricApi.maintenance,
    dashboardPublicApi: dashboard.publicApi,
    goalPublicApi: goal.publicApi,
    goalWorkerRuntime: goal.worker,
    activityPublicApi: activity.publicApi,
    activityWorkerRuntime: Object.freeze({
      projectRecentActivity: activity.worker.projectRecentActivity,
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
    policyAdmin: identity.policy.admin,
    portalPublicApi: portal.publicApi,
    notificationWorkerRuntime: Object.freeze({
      notificationRepo: notification.delivery.repos.notificationRepo,
      emailRepo: notification.delivery.repos.emailRepo,
      preferenceRepo: notification.delivery.repos.preferenceRepo,
    }),
    handleResendEvent: notification.delivery.handleResendEvent,
    notificationAudienceAuthorizer: notification.delivery.authorizeAudience,
    notificationDeliverySettlement: notification.delivery.deliverySettlement,
    // The notification-gap healing sweep (registered by bootstrap on the
    // worker path). Undefined when no job queue exists.
    reconcileMissingNotificationsHandler:
      notification.delivery.reconcileMissingNotificationsHandler,
    // BQC-2.2: version-gated strong read of persisted policy state.
    // Workers await this before starting; side-effect paths use it for
    // fresh reads (BQC-2.5). Owned by the identity build (readiness).
    refreshPolicyStore: identity.policy.refresh,
    // `providerSubjectKeys` is always a service — the real keyring-backed one
    // when the writer material is configured, otherwise the secret-free deny
    // adapter whose acquireDeriver() throws `config_invalid`. So this IS the
    // boot-time inventory-parity check: it verifies the decoded worker key set
    // against the database's masked inventory before any job runs. The
    // env-level precondition is enforced earlier, at container construction
    // (assertReviewProviderSubjectKeysConfigured).
    refreshReviewProviderSubjectKeys: review.worker.refreshProviderSubjectKeys,
    registerReviewWorkerJobs: ({
      reviewDiscoveryIntervalMs,
    }: {
      reviewDiscoveryIntervalMs: number
    }) =>
      review.worker.registerWorkerJobs({
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

export function createContainer(options?: CreateContainerOptions) {
  return buildContainer(options, 'required')
}

export function createOperatorContainerGraph(options?: CreateContainerOptions) {
  return buildContainer(options, 'refusing')
}

type BuiltContainer = ReturnType<typeof createContainer>
export type Container = Omit<BuiltContainer, 'simulationRuntime'>
export type SimulationContainer = BuiltContainer & {
  simulationRuntime: NonNullable<BuiltContainer['simulationRuntime']>
}

// BQC-7.1: the production build bundles this module twice, so the singleton is
// keyed by `Symbol.for` — see `composition/container-partition` for the same
// reasoning applied to the process claim.
const CONTAINER_KEY = Symbol.for('repkey.composition.container')
type ContainerStore = { [CONTAINER_KEY]?: WebContainer }

function containerStore(): ContainerStore {
  return globalThis as ContainerStore
}

/** The singleton, projected to the web deployable and claiming the process. */
export function getContainer(): WebContainer {
  const store = containerStore()
  if (store[CONTAINER_KEY]) return store[CONTAINER_KEY]
  claimDeployable('web')
  return (store[CONTAINER_KEY] = projectContainer(createContainer(), 'web'))
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
  releaseDeployableClaim()
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
