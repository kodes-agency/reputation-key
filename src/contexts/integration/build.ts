// Integration context — build function.
// Wires integration repos, adapters, use cases, and the GbpQueuePort.
// Per ADR-0001: the composition root calls this and passes useCases to the container.
//
// Cross-context contributions exposed to the composition root (BQC-5.2):
//   - internal.googleReviewApi — the Google review API adapter, typed by
//     review's GoogleReviewApiPort (integration owns connection/token/refresh).
//   - internal.gbpNotificationHandler — curried webhook binder; the root
//     supplies the review-owned queue at container assembly.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import { createJobExecutionEnvelope } from '#/shared/jobs/delayed-execution-gate'
import type { GoogleImportV2QueuePort } from './application/ports/gbp-queue.port'
import type {
  GoogleOAuthPort,
  GoogleOAuthProviderCallAuthorizer,
} from './application/ports/google-oauth.port'
import type { OAuthStateHandleService } from './application/oauth-state-handle'
import type { OAuthCallbackAbuseGate } from './application/oauth-callback-abuse-gate'
import type { GbpApiPort } from './application/ports/gbp-api.port'
import type { GoogleAuthorizedProviderExecutor } from './application/ports/google-authorized-provider-executor.port'
import type { GoogleReviewSyncProviderCallAuthorization } from './application/google-provider-contract'
import type { GoogleImportReferenceStore } from './application/ports/google-import-reference-store.port'
import type { PropertyFkCleanupPort } from './application/ports/property-fk-cleanup.port'
import type {
  PropertyGoogleBindingPublicApi,
  PropertyPublicApi,
} from '#/contexts/property/application/public-api'
import type {
  GoogleReviewApiPort,
  TargetedGoogleReviewReferenceResolver,
} from '#/contexts/review/application/public-api'
import type {
  ReviewQueuePort,
  TargetedGoogleReviewQueuePort,
} from '#/contexts/review/application/public-api'
import {
  connectGoogleAccount,
  disconnectGoogleAccount,
  listGoogleConnections,
  updateConnectionVisibility,
  refreshGoogleToken,
  getGoogleAuthUrl,
  manageNotifications,
  handleGbpNotification,
  createGbpSubscribeBackfill,
  prepareGoogleConnectorDeparture,
} from './application/use-cases'
import type { HandleGbpNotification } from './application/use-cases'
import { createGoogleConnectionRepository } from './infrastructure/repositories/google-connection.repository'
import { createGoogleImportV2Store } from './infrastructure/google-import-v2-store'
import { createImportItemRoutingLoader } from './infrastructure/import-item-routing.adapter'
import { createAtomicIntegrationCommandStore } from './infrastructure/integration-command-store'
import { createGoogleConnectorDepartureStore } from './infrastructure/google-connector-departure.store'
import {
  registerGoogleImportDispatchConsumer,
  registerProviderAuthorizationInvalidationConsumer,
} from './infrastructure/outbox-consumers'
import { registerGoogleReviewPushDispatchConsumer } from './infrastructure/google-review-push-outbox-consumers'
import type { ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { GOOGLE_PROPERTY_IMPORT_ITEM_JOB } from './application/google-import-v2-contract'
import { createCredentialLifecycleRepository } from './infrastructure/repositories/credential-lifecycle.repository'
import { createGoogleOAuthExchangeRecoveryRepository } from './infrastructure/repositories/google-oauth-exchange-recovery.repository'
import { createGoogleDisconnectRevokeRepository } from './infrastructure/repositories/google-disconnect-revoke.repository'
import type { GoogleDisconnectRevokeStore } from './application/google-disconnect-revoke'
import { createGoogleOAuthAdapter } from './infrastructure/adapters/google-oauth.adapter'
import { createTokenEncryptionAdapter } from './infrastructure/adapters/token-encryption.adapter'
import { createMyBusinessNotificationsAdapter } from './infrastructure/adapters/mybusiness-notifications.adapter'
import { createGoogleReviewApiAdapter } from './infrastructure/adapters/google-review-api.adapter'
import { createGoogleAccountManagementAdapter } from './infrastructure/adapters/google-account-management.adapter'
import { createGoogleBusinessInformationAdapter } from './infrastructure/adapters/google-business-information.adapter'
import { createSingle401RefreshExecutor } from './infrastructure/adapters/google-single-401-refresh-executor'
import type { GoogleRefreshCoordination } from './application/ports/google-refresh-coordination.port'
import { createActiveConnectionTokenProvider } from './application/active-connection-token-provider'
import {
  createGoogleImportCommandAuthorizer,
  type GoogleImportContentAuthorizer,
} from './application/google-import-command-authorizer'
import { createGoogleImportPropertyClassifier } from './application/google-import-property-classifier'
import { createGoogleImportDiscovery } from './application/google-import-discovery'
import { createGoogleImportTransaction } from './application/google-import-transaction'
import {
  createGoogleImportV2Processor,
  type GoogleImportV2Processor,
} from './application/google-import-v2-processor'
import { createGoogleImportV2Lifecycle } from './application/google-import-v2-lifecycle'
import { createGetPropertyGooglePerformance } from './application/get-property-google-performance'
import { createRenewGooglePerformanceLease } from './application/renew-google-performance-lease'
import {
  createGooglePerformanceAuthorizer,
  type PerformanceContentAuthorizer,
} from './application/google-performance-authorizer'
import {
  createGoogleReviewSyncAuthorizer,
  type GoogleReviewSyncContentAuthorizer,
} from './application/google-review-sync-authorizer'
import {
  createGoogleReplyPublicationAuthorizer,
  type GoogleReplyPublicationContentAuthorizer,
} from './application/google-reply-publication-authorizer'
import { createGooglePerformanceAdapter } from './infrastructure/adapters/google-performance.adapter'
import { getExecutionPolicy, type DecisionRequest } from '#/shared/auth/execution-policy'
import type { RequiredPolicyRefreshResult } from '#/shared/auth/persisted-policy-store'
import { createActiveMemberAuthResolver } from './infrastructure/active-member-auth.adapter'
import type { PropertyLookupPort } from './application/ports/property-lookup.port'
import { parseGbpNotificationSubscriptionConfig } from './application/notification-subscription-config'
import type { SourceContentPurge } from '#/contexts/review/application/public-api'
import type { ProviderEndpoints } from '#/shared/routing/processing-router'
import { googleConnectionId, propertyId } from '#/shared/domain/ids'
import { createProviderAuthorizationInvalidationFanout } from '#/shared/provider-ephemeral/authorization-invalidation'

import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { ProviderAuthorizationLeaseService } from '#/shared/provider-ephemeral/authorization-lease'
import type { ProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import {
  createGoogleReviewCursorStore,
  createUnavailableGoogleReviewCursorStore,
  type GoogleReviewCursorStore,
} from './infrastructure/google-review-cursor-store'
import {
  createUnavailableGoogleReviewPushReferenceStore,
  type GoogleReviewPushReferenceStore,
} from './application/ports/google-review-push-reference.port'
import { createGoogleReviewPushReferenceStore } from './infrastructure/google-review-push-reference-store'
import { createGbpReviewPushReceiptStore } from './infrastructure/gbp-review-push-receipt.store'
import { createGoogleReviewPushTargetResolver } from './infrastructure/adapters/google-review-push-target-resolver.adapter'
import type { GooglePerformanceDependencyDescriptor } from '#/shared/architecture/google-performance-live-boundary'
import type { DataCellId } from '#/shared/domain/data-cell-catalogue'
import type { DataCellExecutionDecision } from '#/shared/routing/data-cell-execution-fence'
import { createDirectGoogleCredentialUseGate } from './application/google-credential-execution-gate'
import { createGoogleCredentialHomeCapture } from './application/google-credential-home'
import { createOrganizationGoogleCredentialHomeAuthority } from './infrastructure/organization-google-credential-home-authority'
import { createIntegrationOrganizationExportContributor } from './infrastructure/adapters/integration-organization-export.adapter'
import { createIntegrationOrganizationLifecycleContributor } from './infrastructure/adapters/integration-organization-lifecycle.adapter'
import { createGoogleOrganizationClosureProvider } from './infrastructure/adapters/google-organization-closure-provider.adapter'

/**
 * ADR 0050 §10: the live Google Performance path may not depend on a write
 * repository, a queue/job, a server cache, or Metric. This array is the machine-
 * readable statement of what the real wiring below actually injects into
 * `createGetPropertyGooglePerformance` (see the block that assigns
 * `getPropertyGooglePerformance`) — one entry per injected dependency, naming
 * the property it is injected as and the module specifier it comes from.
 *
 * `src/shared/architecture/google-performance-live-boundary.test.ts` asserts
 * `validateGooglePerformanceLiveDependencies` over this array AND parses the
 * real call site to require the injected property names to match `injectedAs`
 * exactly, so a new injected dependency cannot be added without appearing here
 * (and therefore without facing the validator). The same test walks the use
 * case's transitive runtime module graph against the forbidden module paths, so
 * a forbidden dependency reached indirectly also fails.
 */
export type GooglePerformanceWiringDescriptor = GooglePerformanceDependencyDescriptor &
  Readonly<{ injectedAs: string }>

export const GOOGLE_PERFORMANCE_LIVE_DEPENDENCY_DESCRIPTORS: readonly GooglePerformanceWiringDescriptor[] =
  Object.freeze([
    // Interactive authorization seam (ExecutionPolicy + Google Content authority
    // + property binding read); no durable Performance write.
    Object.freeze({
      injectedAs: 'authorize',
      kind: 'execution_policy',
      modulePath: '#/contexts/integration/application/google-performance-authorizer',
    }),
    // Request-lifetime provider read adapter. It is under infrastructure/ but is
    // an adapter, not a repositories/jobs/queues/cache module.
    Object.freeze({
      injectedAs: 'fetchReport',
      kind: 'google_performance_source',
      modulePath:
        '#/contexts/integration/infrastructure/adapters/google-performance.adapter',
    }),
    Object.freeze({
      injectedAs: 'issueLease',
      kind: 'provider_content_lease',
      modulePath: '#/shared/provider-ephemeral/authorization-lease',
    }),
    Object.freeze({
      injectedAs: 'clock',
      kind: 'clock',
      modulePath: '#/shared/domain/clock',
    }),
  ])

function sameAuthorizationVectorExceptCredentialGeneration(
  left: Readonly<Record<string, string | number | boolean | null>>,
  right: Readonly<Record<string, string | number | boolean | null>>,
): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        (key === 'credentialGeneration' || left[key] === right[key]),
    )
  )
}

type IntegrationContextDeps = Readonly<{
  db: Database
  outboxRepo: OutboxRepository
  events: EventBus
  clock: () => Date
  idGen: () => string
  invalidationOwnerGen: () => string
  jobQueue: Queue | undefined
  propertyApi: PropertyPublicApi
  propertyBindingApi?: PropertyGoogleBindingPublicApi
  enqueueReviewSync?: ReviewQueuePort['addSyncJob']
  enqueueTargetedReviewFetch?: TargetedGoogleReviewQueuePort['addTargetedFetchJob']
  /** BQC-2.7: grants a newly imported property its organization's capability
   * allowlist (identity-owned, idempotent). Absent = no provisioning. */
  provisionPropertyCapabilities?: (
    input: Readonly<{
      organizationId: string
      propertyId: string
      createdBy: string
    }>,
  ) => Promise<void>
  logger: LoggerPort
  /** BQC-1.7: bounded lifecycle purge of a revoked connection's source
   * content. Constructed once by the composition root (the only layer that
   * may import review infrastructure) and shared across contexts. */
  sourceContentPurge: SourceContentPurge
  /** BQC-4.3: provider endpoint construction config resolved ONCE by the
   * composition root from the cell's logical provider reference
   * (ProcessingTarget.provider). Adapters never hardcode URLs. */
  providerEndpoints: ProviderEndpoints
  /**
   * Parsed once by the process composition boundary. Integration construction
   * must be deterministic and must not re-read ambient process configuration.
   */
  config: Readonly<{
    nodeEnv: 'development' | 'production' | 'test'
    googleClientId: string
    googleClientSecret: string
    encryptionKey: string
    authBaseUrl: string
    pubsubTopic: string
    pubsubNotificationTypes: string
  }>
  /** BQC-6.1: optional deterministic adapter overrides (simulations/tests
   * inject in-memory providers; absent = the real env-driven HTTP adapters). */
  googleOAuth?: GoogleOAuthPort
  gbpApi?: GbpApiPort
  googleAuthorizedProviderExecutor?: GoogleAuthorizedProviderExecutor
  googleDisconnectRevokeStore?: GoogleDisconnectRevokeStore
  authorizeGoogleOAuthProviderCall?: GoogleOAuthProviderCallAuthorizer
  googleImportReferences?: GoogleImportReferenceStore
  authorizeGoogleImportContent?: GoogleImportContentAuthorizer
  authorizeGoogleReviewSyncContent?: GoogleReviewSyncContentAuthorizer
  authorizeGoogleReplyPublicationContent?: GoogleReplyPublicationContentAuthorizer
  googleImportReplayKeys?: VersionedHmacKeyring
  authorizeGooglePerformanceContent?: PerformanceContentAuthorizer
  googlePerformancePrincipalKeys?: VersionedHmacKeyring
  providerAuthorizationLeases?: ProviderAuthorizationLeaseService
  providerEphemeralStore?: ProviderEphemeralStore
  googleOpaqueReferenceKeys?: VersionedHmacKeyring
  googleReviewCursorStore?: GoogleReviewCursorStore
  oauthStateHandles?: OAuthStateHandleService
  oauthCallbackAbuseGate?: OAuthCallbackAbuseGate
  /**
   * The identity policy store's MANDATORY refresh
   * (`persisted-policy-store.ts`: "Mandatory provider/effect refresh. Failure
   * is explicit and never authorizes from cache."). Typed as its real result
   * rather than `unknown` so `{ unavailable: true }` is expressible — with
   * `unknown` the failure signal could not be read at all, which is how this
   * call site came to discard it.
   */
  refreshPolicyStoreRequired?: () => Promise<RequiredPolicyRefreshResult>
  /** Redis-backed, renewable and generation-fenced refresh coordination. */
  googleRefreshCoordination?: GoogleRefreshCoordination
  /** Production fail-closed check for the review adapter's DIRECT `fetch`
   * fallback (bypasses admission, quota control, credential binding, mTLS).
   * Wired by the composition root, which owns env; absent = today's
   * behaviour, which is what simulations and tests rely on. */
  assertDirectProviderEgressAllowed?: (operation: string) => void
  /** Production has no escape hatch for credential-bearing OAuth sockets. */
  assertDirectCredentialEgressAllowed?: (operation: string) => void
  localDataCellId: DataCellId
  admitPropertyExecution(propertyId: string): Promise<DataCellExecutionDecision>
}>

export type IntegrationContextApi = Readonly<{
  /** Request-facing Integration capabilities grouped by workflow. */
  publicApi: Readonly<{
    connections: Readonly<{
      connect: ReturnType<typeof connectGoogleAccount>
      resume: ReturnType<typeof connectGoogleAccount>['resume']
      disconnect: ReturnType<typeof disconnectGoogleAccount>
      list: ReturnType<typeof listGoogleConnections>
      updateVisibility: ReturnType<typeof updateConnectionVisibility>
    }>
    oauth: Readonly<{
      getAuthorizationUrl: ReturnType<typeof getGoogleAuthUrl>
      redeemState: OAuthStateHandleService['redeem']
      admitPreState: OAuthCallbackAbuseGate['admitPreState']
      admitResolvedTenant: OAuthCallbackAbuseGate['admitResolvedTenant']
    }>
    imports: Readonly<{
      discover: ReturnType<typeof createGoogleImportDiscovery> | null
      transact: ReturnType<typeof createGoogleImportTransaction> | null
    }>
    performance: Readonly<{
      get: ReturnType<typeof createGetPropertyGooglePerformance> | null
      renewLease: ReturnType<typeof createRenewGooglePerformanceLease> | null
    }>
  }>
  /** Operator-only subscription and import recovery interfaces. */
  maintenance: Readonly<{
    subscribeNotifications: ReturnType<typeof createGbpSubscribeBackfill>
    imports: Readonly<{
      inspectBacklog:
        ReturnType<typeof createGoogleImportV2Lifecycle>['inspectBacklog'] | null
      inspectScope:
        ReturnType<typeof createGoogleImportV2Lifecycle>['inspectScope'] | null
      inspectRequest:
        ReturnType<typeof createGoogleImportV2Lifecycle>['inspectRequest'] | null
      cancelRequest:
        ReturnType<typeof createGoogleImportV2Lifecycle>['cancelRequest'] | null
      sweep: ReturnType<typeof createGoogleImportV2Lifecycle>['sweep'] | null
    }>
  }>
  /** Cross-context account/import teardown authority. */
  lifecycle: Readonly<{
    prepareConnectorDeparture: ReturnType<typeof prepareGoogleConnectorDeparture>
    cancelImportsForConnection:
      ReturnType<typeof createGoogleImportV2Lifecycle>['cancelConnection'] | null
    cancelImportsForUser:
      ReturnType<typeof createGoogleImportV2Lifecycle>['cancelUser'] | null
    cancelImportsForOrganization:
      ReturnType<typeof createGoogleImportV2Lifecycle>['cancelOrganization'] | null
    preparePropertyDeletion:
      ReturnType<typeof createGoogleImportV2Lifecycle>['preparePropertyDeletion'] | null
    finalizePropertyDeletion:
      ReturnType<typeof createGoogleImportV2Lifecycle>['finalizePropertyDeletion'] | null
  }>
  /** Authenticated GBP notification ingress. */
  webhook: Readonly<{ handleNotification: HandleGbpNotification }>
  /** Context-owned worker registration; exposes no repositories or use cases. */
  worker: Readonly<{
    registerOutboxConsumers: (consumerRegistry: ConsumerRegistry) => void
    processImportItem: GoogleImportV2Processor['process'] | null
    sweepImportLifecycle: ReturnType<typeof createGoogleImportV2Lifecycle>['sweep'] | null
  }>
  /** ARC-03-T12: the named provider capabilities the Review build consumes. */
  reviewSync: Readonly<{
    /** BQC-5.2: the Google review API adapter, typed by Review's port. */
    googleReviewApi: GoogleReviewApiPort
    /** Identifier-only reference resolver consumed by Review's targeted job. */
    googleReviewPushTargetResolver: TargetedGoogleReviewReferenceResolver
  }>
  internal: Readonly<{
    repos: Readonly<{
      connectionRepo: ReturnType<typeof createGoogleConnectionRepository>
      encryptionPort: ReturnType<typeof createTokenEncryptionAdapter>
      oauthPort: ReturnType<typeof createGoogleOAuthAdapter>
      /** BQC-6.1: exposed (like oauthPort) so build-level tests can prove
       * provider overrides are honored. */
      credentialLifecycle: ReturnType<typeof createCredentialLifecycleRepository>
      googleOAuthExchangeRecovery: ReturnType<
        typeof createGoogleOAuthExchangeRecoveryRepository
      >
      gbpApiPort: GbpApiPort
      loadImportItemRouting: ReturnType<typeof createImportItemRoutingLoader>
    }>
    /** BQC-5.2: the Google review API adapter (integration-owned), typed by
     * review's port — consumed by the review context build. */
    googleReviewApi: GoogleReviewApiPort
    /** Identifier-only reference resolver consumed by Review's targeted job. */
    googleReviewPushTargetResolver: TargetedGoogleReviewReferenceResolver
    /** Authenticated ingress handler; receipt + outbox fact commit atomically. */
    gbpNotificationHandler: HandleGbpNotification
    useCases: Readonly<{
      connectGoogleAccount: ReturnType<typeof connectGoogleAccount>
      resumeGoogleAccountConnection: ReturnType<typeof connectGoogleAccount>['resume']
      disconnectGoogleAccount: ReturnType<typeof disconnectGoogleAccount>
      listGoogleConnections: ReturnType<typeof listGoogleConnections>
      updateConnectionVisibility: ReturnType<typeof updateConnectionVisibility>
      refreshGoogleToken: ReturnType<typeof refreshGoogleToken>
      prepareGoogleConnectorDeparture: ReturnType<typeof prepareGoogleConnectorDeparture>
      googleImportDiscovery: ReturnType<typeof createGoogleImportDiscovery> | null
      googleImportTransaction: ReturnType<typeof createGoogleImportTransaction> | null
      processGoogleImportV2Item: GoogleImportV2Processor['process'] | null
      getPropertyGooglePerformance: ReturnType<
        typeof createGetPropertyGooglePerformance
      > | null
      renewGooglePerformanceLease: ReturnType<
        typeof createRenewGooglePerformanceLease
      > | null
      admitGoogleOAuthCallbackTenant: OAuthCallbackAbuseGate['admitResolvedTenant']
      sweepGoogleImportV2Lifecycle:
        ReturnType<typeof createGoogleImportV2Lifecycle>['sweep'] | null
      inspectGoogleImportV2Lifecycle:
        ReturnType<typeof createGoogleImportV2Lifecycle>['inspectBacklog'] | null
      inspectGoogleImportV2LifecycleScope:
        ReturnType<typeof createGoogleImportV2Lifecycle>['inspectScope'] | null
      cancelGoogleImportV2ForConnection:
        ReturnType<typeof createGoogleImportV2Lifecycle>['cancelConnection'] | null
      cancelGoogleImportV2ForUser:
        ReturnType<typeof createGoogleImportV2Lifecycle>['cancelUser'] | null
      cancelGoogleImportV2ForOrganization:
        ReturnType<typeof createGoogleImportV2Lifecycle>['cancelOrganization'] | null
      prepareGoogleImportV2PropertyDeletion:
        ReturnType<typeof createGoogleImportV2Lifecycle>['preparePropertyDeletion'] | null
      finalizeGoogleImportV2PropertyDeletion:
        | ReturnType<typeof createGoogleImportV2Lifecycle>['finalizePropertyDeletion']
        | null
      cancelGoogleImportV2Request:
        ReturnType<typeof createGoogleImportV2Lifecycle>['cancelRequest'] | null
      inspectGoogleImportV2Request:
        ReturnType<typeof createGoogleImportV2Lifecycle>['inspectRequest'] | null
    }>
  }>
}>

// Accepted residual: this is the integration context's composition root, and
// its 47 code paths are 47 optional dependencies, not 47 decisions — the same
// per-dependency override shape createContainer carries in src/composition.ts.
// Already over both thresholds on main; this branch added only wiring
// (`gbpSubscribeBackfill`, and `subscribeToNotifications` passed into the
// import processor), no new branching. Extraction here does not reduce
// complexity, it scatters it: the value of a composition root is that every
// binding is legible in ONE place, and splitting it into per-area builders
// would trade a high metric for real indirection while a reviewer's question
// ("what is this port wired to?") gets harder to answer.
// Revisit when this function starts making POLICY decisions rather than
// choosing implementations — branching on tenant state or request shape is the
// signal it has stopped being wiring.
// fallow-ignore-next-line complexity
export const buildIntegrationContext = (deps: IntegrationContextDeps) => {
  // ── Cross-context port implementations (wiring layer) ──────────
  // Delegated through PropertyPublicApi — no direct schema imports.

  const propertyFkCleanup: PropertyFkCleanupPort = {
    clearGoogleConnectionRef: deps.propertyApi.clearGoogleConnectionRef,
  }

  // ── Repositories ─────────────────────────────────────────────────
  const connectionRepo = createGoogleConnectionRepository(
    deps.db,
    propertyFkCleanup,
    deps.clock,
  )
  // BQC-3.5: every integration state mutation + fact commits atomically here.
  const credentialLifecycle = createCredentialLifecycleRepository(deps.db)
  const googleOAuthExchangeRecovery = createGoogleOAuthExchangeRecoveryRepository(deps.db)
  const googleDisconnectRevokeStore =
    deps.googleDisconnectRevokeStore ??
    createGoogleDisconnectRevokeRepository(deps.db, deps.events)
  const commandStore = createAtomicIntegrationCommandStore(
    deps.db,
    deps.events,
    deps.clock,
  )
  const connectorDepartureStore = createGoogleConnectorDepartureStore(
    deps.db,
    deps.events,
  )

  // ── Adapters ──────────────────────────────────────────────────────
  // BQC-4.3: every Google endpoint comes from the composition-resolved
  // providerEndpoints (the cell's approved provider ref) — nowhere else.
  // BQC-6.1: injected provider overrides win; absent slots build the real
  // env-driven adapters exactly as before.
  const oauthPort =
    deps.googleOAuth ??
    createGoogleOAuthAdapter({
      clientId: deps.config.googleClientId,
      clientSecret: deps.config.googleClientSecret,
      tokenUrl: deps.providerEndpoints.oauthTokenUrl,
      jwksUrl: deps.providerEndpoints.oauthJwksUrl,
      revokeUrl: deps.providerEndpoints.oauthRevokeUrl,
      clock: deps.clock,
      executor: deps.googleAuthorizedProviderExecutor,
      nowMs: () => deps.clock().getTime(),
      ...(deps.assertDirectCredentialEgressAllowed === undefined
        ? {}
        : {
            assertDirectCredentialEgressAllowed: deps.assertDirectCredentialEgressAllowed,
          }),
    })
  const encryptionPort = createTokenEncryptionAdapter(deps.config.encryptionKey)
  // Legacy-only test seam. Production no longer constructs the credential-
  // bearing direct account adapter; notification account discovery uses the
  // governed typed executor below.
  const gbpApiPort: GbpApiPort =
    deps.gbpApi ??
    Object.freeze({
      listAccounts: async () => {
        throw new Error('Legacy Google account lookup is unavailable')
      },
    })
  const loadImportItemRouting = createImportItemRoutingLoader({ db: deps.db })
  const assertDirectCredentialUse = createDirectGoogleCredentialUseGate({
    localCellId: deps.localDataCellId,
    admitPropertyExecution: deps.admitPropertyExecution,
  })
  const captureCredentialHome = createGoogleCredentialHomeCapture({
    authority: createOrganizationGoogleCredentialHomeAuthority(deps.db),
    localCellId: deps.localDataCellId,
  })

  const googleImportV2Store = createGoogleImportV2Store(deps.db, deps.clock)
  const googleReviewPushReferences: GoogleReviewPushReferenceStore =
    deps.providerEphemeralStore && deps.googleOpaqueReferenceKeys
      ? createGoogleReviewPushReferenceStore({
          store: deps.providerEphemeralStore,
          keys: deps.googleOpaqueReferenceKeys,
          nowMs: () => deps.clock().getTime(),
        })
      : createUnavailableGoogleReviewPushReferenceStore()
  const gbpReviewPushReceipts = createGbpReviewPushReceiptStore(deps.db)
  const targetedGoogleReviewQueue: TargetedGoogleReviewQueuePort | null =
    deps.enqueueTargetedReviewFetch
      ? { addTargetedFetchJob: deps.enqueueTargetedReviewFetch }
      : null
  // ── Queue Port ───────────────────────────────────────────────────
  if (!deps.jobQueue) throw new Error('jobQueue required')
  const jobQueue = deps.jobQueue

  // One child import batch fans out up to 100 item jobs in a single addBulk, so
  // the queue depth is intentionally far above what the pool can execute at
  // once. Safety comes from the worker side, not from throttling here:
  // DEFAULT_QUEUE_CONCURRENCY * WORST_CASE_POOL_CLIENTS_PER_JOB <= pool max
  // (see #/shared/jobs/worker), because each item holds its fenced
  // `FOR UPDATE` transaction while the nested Property effect opens a second
  // one. If that budget is ever violated, every worker slot holds a client
  // and the nested acquisitions deadlock until connectionTimeoutMillis.
  const googleImportV2Queue: GoogleImportV2QueuePort = {
    addImportItemJobs: async (jobs) => {
      if (jobs.length === 0) return
      const options = jobEnqueueOptions(GOOGLE_PROPERTY_IMPORT_ITEM_JOB)
      await jobQueue.addBulk(
        jobs.map((job) => {
          const execution = createJobExecutionEnvelope({
            organizationId: job.organizationId,
            capability: 'property.import_gbp_v2',
            initiator: {
              kind: 'system',
              id: 'outbox:google-property-import-dispatch',
            },
          })
          return {
            name: GOOGLE_PROPERTY_IMPORT_ITEM_JOB,
            data: { ...job, ...execution },
            opts: {
              jobId: job.jobId,
              removeOnComplete: { count: 100 },
              removeOnFail: { count: 50 },
              ...options,
            },
          }
        }),
      )
    },
  }

  const invalidationReferences = deps.googleImportReferences
  const providerAuthorizationInvalidation =
    deps.providerEphemeralStore && invalidationReferences
      ? createProviderAuthorizationInvalidationFanout({
          store: deps.providerEphemeralStore,
          receipts: deps.outboxRepo,
          randomOwner: deps.invalidationOwnerGen,
          handlers: [
            {
              id: 'google_import_references',
              invalidate: async (event) => {
                const results = await Promise.all([
                  event.propertyId
                    ? invalidationReferences.invalidateProperty({
                        organizationId: event.organizationId,
                        propertyId: event.propertyId,
                      })
                    : Promise.resolve(true),
                  event.connectionId
                    ? invalidationReferences.invalidateConnection({
                        organizationId: event.organizationId,
                        connectionId: event.connectionId,
                      })
                    : Promise.resolve(true),
                ])
                if (results.some((result) => !result)) {
                  throw new Error('Google import reference invalidation failed')
                }
              },
            },
          ],
        })
      : null

  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) => {
    registerGoogleImportDispatchConsumer(consumerRegistry, {
      store: googleImportV2Store,
      queue: googleImportV2Queue,
      receipts: deps.outboxRepo,
    })
    if (providerAuthorizationInvalidation) {
      registerProviderAuthorizationInvalidationConsumer(consumerRegistry, {
        fanout: providerAuthorizationInvalidation,
        receipts: deps.outboxRepo,
        nowMs: () => deps.clock().getTime(),
      })
    }
    if (targetedGoogleReviewQueue) {
      registerGoogleReviewPushDispatchConsumer(consumerRegistry, {
        queue: targetedGoogleReviewQueue,
        receipts: deps.outboxRepo,
      })
    }
  }

  // ── Use Cases ────────────────────────────────────────────────────
  const refreshGoogleTokenUseCase = refreshGoogleToken({
    connectionRepo,
    oauth: oauthPort,
    encryption: encryptionPort,
    clock: deps.clock,
    assertDirectCredentialUse,
    authorizeProviderCall: deps.authorizeGoogleOAuthProviderCall,
    ...(deps.googleRefreshCoordination === undefined
      ? {}
      : { coordination: deps.googleRefreshCoordination }),
  })
  const activeConnectionTokenProvider = createActiveConnectionTokenProvider({
    connectionRepo,
    encryption: encryptionPort,
    clock: deps.clock,
    refreshGoogleToken: refreshGoogleTokenUseCase,
    assertDirectCredentialUse,
  })
  let reauthorizeGoogleImportProviderCall:
    Parameters<typeof createSingle401RefreshExecutor>[0]['reauthorize'] | undefined
  let reauthorizeGoogleNotificationProviderCall:
    Parameters<typeof createSingle401RefreshExecutor>[0]['reauthorize'] | undefined
  let authorizeGoogleNotificationProviderCall:
    Parameters<typeof manageNotifications>[0]['authorizeProviderCall'] | undefined
  const googleImportProviderExecutor = deps.googleAuthorizedProviderExecutor
    ? createSingle401RefreshExecutor({
        executor: deps.googleAuthorizedProviderExecutor,
        refreshAccessToken: ({ authorization }) =>
          activeConnectionTokenProvider.forceRefreshAccessToken(
            authorization.organizationId,
            authorization.connectionId,
            authorization.expectedCredentialGeneration,
            authorization.propertyId ? [authorization.propertyId] : [],
          ),
        getAccessToken: ({ authorization }) =>
          activeConnectionTokenProvider.getAccessToken(
            authorization.organizationId,
            authorization.connectionId,
            authorization.propertyId ? [authorization.propertyId] : [],
          ),
        reauthorize: async (input) => {
          if (!reauthorizeGoogleImportProviderCall) {
            throw new Error('Google provider reauthorization is unavailable')
          }
          return reauthorizeGoogleImportProviderCall(input)
        },
      })
    : undefined

  const googleNotificationProviderExecutor = deps.googleAuthorizedProviderExecutor
    ? createSingle401RefreshExecutor({
        executor: deps.googleAuthorizedProviderExecutor,
        refreshAccessToken: ({ authorization }) =>
          activeConnectionTokenProvider.forceRefreshAccessToken(
            authorization.organizationId,
            authorization.connectionId,
            authorization.expectedCredentialGeneration,
            authorization.propertyId ? [authorization.propertyId] : [],
          ),
        getAccessToken: ({ authorization }) =>
          activeConnectionTokenProvider.getAccessToken(
            authorization.organizationId,
            authorization.connectionId,
            authorization.propertyId ? [authorization.propertyId] : [],
          ),
        reauthorize: async (input) => {
          if (!reauthorizeGoogleNotificationProviderCall) {
            throw new Error('Google notification reauthorization is unavailable')
          }
          return reauthorizeGoogleNotificationProviderCall(input)
        },
      })
    : undefined
  const notificationsPort = googleNotificationProviderExecutor
    ? createMyBusinessNotificationsAdapter({
        executor: googleNotificationProviderExecutor,
        nowMs: () => deps.clock().getTime(),
      })
    : Object.freeze({
        subscribe: async () => {
          throw new Error('Governed Google notification subscription is unavailable')
        },
        unsubscribe: async () => {
          throw new Error('Governed Google notification subscription is unavailable')
        },
      })
  const notificationConfig = parseGbpNotificationSubscriptionConfig(
    deps.config.pubsubTopic,
    deps.config.pubsubNotificationTypes,
  )

  const manageNotificationsUseCase = manageNotifications({
    authorizeProviderCall: async (organizationIdValue, connectionIdValue) =>
      authorizeGoogleNotificationProviderCall
        ? authorizeGoogleNotificationProviderCall(organizationIdValue, connectionIdValue)
        : { ok: false, code: 'authorization_unavailable' },
    notifications: notificationsPort,
    pubsubTopic: notificationConfig.pubsubTopic,
    notificationTypes: notificationConfig.notificationTypes,
    logger: deps.logger,
  })

  // ops:gbp-subscribe (scripts/ops/gbp-subscribe.ts). Reads the repo directly
  // rather than the listGoogleConnections use case: the operator harness has
  // already authorized the invocation (`system:ops`, audited), and an operator
  // repair must not depend on a tenant's `integration.manage` grant — the same
  // posture as ops:property-capabilities.
  const gbpSubscribeBackfill = createGbpSubscribeBackfill({
    listConnections: (organizationIdValue) =>
      connectionRepo.listByOrganization(organizationIdValue, { showAll: true }),
    subscribe: manageNotificationsUseCase.subscribe,
  })

  let googleImportDiscovery: ReturnType<typeof createGoogleImportDiscovery> | null = null
  let googleImportTransaction: ReturnType<typeof createGoogleImportTransaction> | null =
    null
  let googleImportV2Processor: GoogleImportV2Processor | null = null
  const resolveActiveMember = createActiveMemberAuthResolver(deps.db)
  const googleImportV2Lifecycle = deps.propertyBindingApi
    ? createGoogleImportV2Lifecycle({
        store: googleImportV2Store,
        propertyBindingApi: deps.propertyBindingApi,
        clock: deps.clock,
        newEventId: deps.idGen,
        references: deps.googleImportReferences,
      })
    : null
  const sweepGoogleImportV2Lifecycle = googleImportV2Lifecycle?.sweep ?? null
  if (deps.propertyBindingApi) {
    const propertyBindingApi = deps.propertyBindingApi
    /**
     * Mandatory policy refresh, HONOURED.
     *
     * `persisted-policy-store.ts` on `refreshRequired`: "Mandatory
     * provider/effect refresh. Failure is explicit and never authorizes from
     * cache." Awaiting it and discarding the result broke precisely that: a
     * failed refresh keeps the PREVIOUS snapshot, so `decide` then ran on a
     * cache already known to be invalid.
     *
     * Not hypothetical. One import item's capability provisioning bumps the
     * GLOBAL policy_version; a sibling item authorizing concurrently straddles
     * that bump between `refreshAuthoritative`'s control read and its snapshot
     * load, which throws 'policy snapshot generation mismatch' and reports
     * `{ unavailable: true }`. Deciding anyway denied the sibling
     * `property_not_allowlisted` and terminalized it `authorization_changed`
     * — cancelled, retryable: false, userAction 'none' — over a capability
     * that had just been GRANTED.
     *
     * Throwing reaches the authorizer's own catch, which denies
     * `runtime_unavailable`; the item processor maps that to no outcome code
     * and rethrows, so the item RETRIES. Bounded, not a loop: retries stop at
     * `GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS` or once the next backoff would cross
     * the item's effect deadline, after which it settles
     * `temporarily_unavailable` (retryable, userAction 'retry').
     */
    const refreshedPolicyControl = async (
      refresh: () => Promise<RequiredPolicyRefreshResult>,
    ): Promise<Exclude<RequiredPolicyRefreshResult, { unavailable: true }>> => {
      const control = await refresh()
      if ('unavailable' in control) {
        throw new Error('Google import policy refresh is unavailable')
      }
      return control
    }
    const decideGoogleImport = async (request: DecisionRequest) => {
      const refresh = deps.refreshPolicyStoreRequired
      if (refresh) await refreshedPolicyControl(refresh)
      return getExecutionPolicy().decide(request)
    }
    const authorizeGoogleImportCommand = createGoogleImportCommandAuthorizer({
      connectionRepo,
      tokenProvider: activeConnectionTokenProvider,
      decide: decideGoogleImport,
      authorizeGoogleContent:
        deps.authorizeGoogleImportContent ??
        (async () => ({ ok: false as const, code: 'runtime_unavailable' as const })),
      readProperty: async (organizationId, propertyId) => {
        const property = await propertyBindingApi.readInternal(organizationId, propertyId)
        return property
          ? {
              propertyId: property.propertyId,
              sourceEpoch: property.sourceEpoch,
              profileVersion: property.profileVersion,
              lifecycleState: property.lifecycleState,
              deletedAt: property.deletedAt,
            }
          : null
      },
      clock: deps.clock,
      // The refusal is otherwise invisible: six checks share the
      // `authorization_changed` outcome code and the persisted item row cannot
      // say which fired. Content-free fields (ids, version counters, a sha256).
      warn: (fields, message) => deps.logger.warn(fields, message),
    })
    reauthorizeGoogleImportProviderCall = async ({ authorization }) => {
      if (
        authorization.capability !== 'property.import_gbp_v2' ||
        authorization.initiatorUserId === null
      ) {
        throw new Error('Google provider reauthorization is unavailable')
      }
      const actor = await resolveActiveMember(
        authorization.organizationId,
        authorization.initiatorUserId,
      )
      if (!actor) {
        throw new Error('Google provider reauthorization is unavailable')
      }
      const refreshed = await authorizeGoogleImportCommand({
        actor,
        connectionId: authorization.connectionId,
        phase: 'provider_call',
        properties: [],
        requireAccessToken: false,
      })
      if (!refreshed.ok) {
        throw new Error('Google provider reauthorization is unavailable')
      }
      return {
        capability: 'property.import_gbp_v2',
        organizationId: authorization.organizationId,
        propertyId: null,
        connectionId: authorization.connectionId,
        initiatorUserId: refreshed.authorization.userId,
        approvalBindingId: refreshed.authorization.approvalBindingId,
        expectedCredentialGeneration: refreshed.authorization.credentialGeneration,
        authorizationVector: refreshed.authorization.authorizationVector,
      }
    }
    googleImportV2Processor = createGoogleImportV2Processor({
      store: googleImportV2Store,
      propertyBindingApi,
      authorizeGoogleImportCommand,
      enqueueReviewSync: deps.enqueueReviewSync,
      // The one place a Google-backed property becomes live. `subscribe` is a
      // best-effort idempotent PATCH and no-ops when GBP_PUBSUB_TOPIC is empty.
      subscribeToNotifications: manageNotificationsUseCase.subscribe,
      provisionPropertyCapabilities: deps.provisionPropertyCapabilities,
      resolveActor: resolveActiveMember,
      clock: deps.clock,
      newClaimFence: deps.idGen,
      logger: deps.logger,
    })
    if (googleImportProviderExecutor && deps.googleImportReferences) {
      googleImportDiscovery = createGoogleImportDiscovery({
        authorizeGoogleImportCommand,
        classifyCandidates: createGoogleImportPropertyClassifier({
          readByLocationIds: propertyBindingApi.readByLocationIds,
          isAllowed: async ({ actor, action, propertyId }) =>
            (
              await decideGoogleImport({
                principal: { kind: 'user', ctx: actor },
                action,
                capability: 'property.import_gbp_v2',
                organizationId: actor.organizationId,
                ...(propertyId ? { propertyId } : {}),
                executionKind: 'interactive',
                now: deps.clock(),
              })
            ).allowed,
        }),
        references: deps.googleImportReferences,
        accounts: createGoogleAccountManagementAdapter({
          executor: googleImportProviderExecutor,
          nowMs: () => deps.clock().getTime(),
        }),
        locations: createGoogleBusinessInformationAdapter({
          executor: googleImportProviderExecutor,
          nowMs: () => deps.clock().getTime(),
        }),
        nowMs: () => deps.clock().getTime(),
        logger: deps.logger,
      })
    }
    if (deps.googleImportReferences && deps.googleImportReplayKeys) {
      googleImportTransaction = createGoogleImportTransaction({
        store: googleImportV2Store,
        references: deps.googleImportReferences,
        propertyBindingApi,
        authorizeGoogleImportCommand,
        replayKeys: deps.googleImportReplayKeys,
        clock: deps.clock,
        idGen: deps.idGen,
        ...(googleImportV2Lifecycle
          ? { cancelImportSaga: googleImportV2Lifecycle.cancelRequest }
          : {}),
      })
    }
  }
  let getPropertyGooglePerformance: ReturnType<
    typeof createGetPropertyGooglePerformance
  > | null = null
  let renewGooglePerformanceLease: ReturnType<
    typeof createRenewGooglePerformanceLease
  > | null = null
  if (
    deps.propertyBindingApi &&
    deps.googleAuthorizedProviderExecutor &&
    deps.authorizeGooglePerformanceContent &&
    deps.googlePerformancePrincipalKeys &&
    deps.providerAuthorizationLeases
  ) {
    const performanceTokenProvider = createActiveConnectionTokenProvider({
      connectionRepo,
      encryption: encryptionPort,
      clock: deps.clock,
      refreshGoogleToken: refreshGoogleTokenUseCase,
      assertDirectCredentialUse,
    })
    const authorize = createGooglePerformanceAuthorizer({
      resolveActor: createActiveMemberAuthResolver(deps.db),
      readBinding: deps.propertyBindingApi.readInternal,
      findConnection: connectionRepo.findById,
      getAccessToken: performanceTokenProvider.getAccessToken,
      decide: (request) => getExecutionPolicy().decide(request),
      authorizeGoogleContent: deps.authorizeGooglePerformanceContent,
      principalKeys: deps.googlePerformancePrincipalKeys,
      clock: deps.clock,
      logger: deps.logger,
    })
    const performanceProviderExecutor = createSingle401RefreshExecutor({
      executor: deps.googleAuthorizedProviderExecutor,
      refreshAccessToken: ({ authorization }) =>
        performanceTokenProvider.forceRefreshAccessToken(
          authorization.organizationId,
          authorization.connectionId,
          authorization.expectedCredentialGeneration,
          authorization.propertyId ? [authorization.propertyId] : [],
        ),
      getAccessToken: ({ authorization }) =>
        performanceTokenProvider.getAccessToken(
          authorization.organizationId,
          authorization.connectionId,
          authorization.propertyId ? [authorization.propertyId] : [],
        ),
      reauthorize: async ({ authorization }) => {
        if (
          authorization.capability !== 'property.read_gbp_performance' ||
          authorization.propertyId === null ||
          authorization.initiatorUserId === null
        ) {
          throw new Error('Google Performance reauthorization is unavailable')
        }
        const actor = await resolveActiveMember(
          authorization.organizationId,
          authorization.initiatorUserId,
        )
        if (!actor) {
          throw new Error('Google Performance reauthorization is unavailable')
        }
        const refreshed = await authorize({
          actor,
          propertyId: authorization.propertyId,
          phase: 'before_provider',
          requireAccessToken: false,
        })
        if (!refreshed.ok) {
          throw new Error('Google Performance reauthorization is unavailable')
        }
        if (
          refreshed.snapshot.approvalBindingId !== authorization.approvalBindingId ||
          !sameAuthorizationVectorExceptCredentialGeneration(
            refreshed.snapshot.authorizationVector,
            authorization.authorizationVector,
          )
        ) {
          throw new Error('Google Performance reauthorization changed')
        }
        return {
          capability: 'property.read_gbp_performance',
          organizationId: refreshed.snapshot.organizationId,
          propertyId: refreshed.snapshot.propertyId,
          connectionId: refreshed.snapshot.connectionId,
          initiatorUserId: actor.userId,
          approvalBindingId: refreshed.snapshot.approvalBindingId,
          expectedCredentialGeneration: refreshed.snapshot.credentialGeneration,
          authorizationVector: refreshed.snapshot.authorizationVector,
        }
      },
    })
    const source = createGooglePerformanceAdapter({
      executor: performanceProviderExecutor,
      nowMs: () => deps.clock().getTime(),
    })
    // ADR 0050 §10 live boundary. Every property injected here MUST have a
    // matching entry in GOOGLE_PERFORMANCE_LIVE_DEPENDENCY_DESCRIPTORS above;
    // the architecture test parses this call and fails on any drift.
    getPropertyGooglePerformance = createGetPropertyGooglePerformance({
      authorize,
      fetchReport: (input, actor, snapshot, accessToken) =>
        source.fetchReport(input, accessToken, {
          capability: 'property.read_gbp_performance',
          organizationId: snapshot.organizationId,
          propertyId: snapshot.propertyId,
          connectionId: snapshot.connectionId,
          initiatorUserId: actor.userId,
          expectedCredentialGeneration: snapshot.credentialGeneration,
          approvalBindingId: snapshot.approvalBindingId,
          authorizationVector: snapshot.authorizationVector,
        }),
      issueLease: ({ actor, snapshot, absoluteDeadlineMs, nowMs }) =>
        deps.providerAuthorizationLeases!.issue({
          audience: 'performance',
          capability: 'property.read_gbp_performance',
          organizationId: snapshot.organizationId,
          initiatorUserId: actor.userId,
          propertyId: snapshot.propertyId,
          connectionId: snapshot.connectionId,
          approvalBindingId: snapshot.approvalBindingId,
          principalHmacKeyVersion: snapshot.principalHmacKeyVersion,
          principalHmac: snapshot.principalHmac,
          authorizationFenceSha256: snapshot.authorizationFenceSha256,
          absoluteDeadlineMs,
          nowMs,
        }),
      clock: deps.clock,
    })
    renewGooglePerformanceLease = createRenewGooglePerformanceLease({
      authorize,
      renew: deps.providerAuthorizationLeases.renew,
      clock: deps.clock,
    })
  }

  const oauthCallbackAbuseGate =
    deps.oauthCallbackAbuseGate ??
    Object.freeze({
      admitPreState: async () =>
        deps.config.nodeEnv === 'production'
          ? ({ ok: false, code: 'quota_unavailable' } as const)
          : ({ ok: true } as const),
      admitResolvedTenant: async () =>
        deps.config.nodeEnv === 'production'
          ? ({ ok: false, code: 'quota_unavailable' } as const)
          : ({ ok: true } as const),
    })
  if (!deps.oauthStateHandles) {
    throw new Error('Opaque OAuth state service is required')
  }
  const getOpaqueGoogleAuthUrl = getGoogleAuthUrl({
    clientId: deps.config.googleClientId,
    callbackUrl: `${deps.config.authBaseUrl}/api/auth/google/callback`,
    clock: deps.clock,
    stateHandles: deps.oauthStateHandles,
  })

  const googleConnectionCeremony = connectGoogleAccount({
    connectionRepo,
    oauth: oauthPort,
    encryption: encryptionPort,
    commandStore,
    exchangeRecovery: googleOAuthExchangeRecovery,
    clock: deps.clock,
    idGen: deps.idGen,
    callbackUrl: `${deps.config.authBaseUrl}/api/auth/google/callback`,
    captureCredentialHome,
    authorizeProviderCall: deps.authorizeGoogleOAuthProviderCall,
  })

  const useCases = {
    connectGoogleAccount: googleConnectionCeremony,
    resumeGoogleAccountConnection: googleConnectionCeremony.resume,

    disconnectGoogleAccount: disconnectGoogleAccount({
      connectionRepo,
      oauth: oauthPort,
      encryption: encryptionPort,
      commandStore,
      clock: deps.clock,
      logger: deps.logger,
      assertDirectCredentialUse,
      authorizeProviderCall: deps.authorizeGoogleOAuthProviderCall,
      disconnectRevokeStore: googleDisconnectRevokeStore,
      idGen: deps.idGen,
      unsubscribeFromNotifications: manageNotificationsUseCase.unsubscribe,
      sourceContentPurge: deps.sourceContentPurge,
      cancelGoogleImportsForConnection: googleImportV2Lifecycle
        ? async (organizationIdValue, connectionId) => {
            await googleImportV2Lifecycle.cancelConnection(
              organizationIdValue,
              connectionId,
            )
          }
        : undefined,
    }),

    listGoogleConnections: listGoogleConnections({
      connectionRepo,
    }),

    updateConnectionVisibility: updateConnectionVisibility({
      connectionRepo,
      commandStore,
      clock: deps.clock,
    }),

    refreshGoogleToken: refreshGoogleTokenUseCase,

    prepareGoogleConnectorDeparture: prepareGoogleConnectorDeparture({
      store: connectorDepartureStore,
      cancelGoogleImportsForConnection: async (organizationIdValue, connectionId) => {
        if (!googleImportV2Lifecycle) {
          throw new Error('Google import lifecycle unavailable')
        }
        return googleImportV2Lifecycle.cancelConnection(organizationIdValue, connectionId)
      },
      clock: deps.clock,
    }),

    /** ops:gbp-subscribe command core — see scripts/ops/gbp-subscribe.ts. */
    gbpSubscribeBackfill,

    googleImportDiscovery,
    googleImportTransaction,
    processGoogleImportV2Item: googleImportV2Processor?.process ?? null,
    getPropertyGooglePerformance,
    renewGooglePerformanceLease,
    sweepGoogleImportV2Lifecycle,
    inspectGoogleImportV2Lifecycle: googleImportV2Lifecycle?.inspectBacklog ?? null,
    inspectGoogleImportV2LifecycleScope: googleImportV2Lifecycle?.inspectScope ?? null,
    cancelGoogleImportV2ForConnection: googleImportV2Lifecycle?.cancelConnection ?? null,
    cancelGoogleImportV2ForUser: googleImportV2Lifecycle?.cancelUser ?? null,
    cancelGoogleImportV2ForOrganization:
      googleImportV2Lifecycle?.cancelOrganization ?? null,
    prepareGoogleImportV2PropertyDeletion:
      googleImportV2Lifecycle?.preparePropertyDeletion ?? null,
    finalizeGoogleImportV2PropertyDeletion:
      googleImportV2Lifecycle?.finalizePropertyDeletion ?? null,
    cancelGoogleImportV2Request: googleImportV2Lifecycle?.cancelRequest ?? null,
    inspectGoogleImportV2Request: googleImportV2Lifecycle?.inspectRequest ?? null,

    getGoogleAuthUrl: getOpaqueGoogleAuthUrl,
    redeemGoogleOAuthState: deps.oauthStateHandles?.redeem,
    admitGoogleOAuthCallbackPreState: oauthCallbackAbuseGate.admitPreState,
    admitGoogleOAuthCallbackTenant: oauthCallbackAbuseGate.admitResolvedTenant,
  } as const

  // ── Public API — request boundary ───────────────────────────────
  const publicApi = Object.freeze({
    connections: Object.freeze({
      connect: useCases.connectGoogleAccount,
      resume: useCases.resumeGoogleAccountConnection,
      disconnect: useCases.disconnectGoogleAccount,
      list: useCases.listGoogleConnections,
      updateVisibility: useCases.updateConnectionVisibility,
    }),
    oauth: Object.freeze({
      getAuthorizationUrl: useCases.getGoogleAuthUrl,
      redeemState: useCases.redeemGoogleOAuthState,
      admitPreState: useCases.admitGoogleOAuthCallbackPreState,
      admitResolvedTenant: useCases.admitGoogleOAuthCallbackTenant,
    }),
    imports: Object.freeze({
      discover: useCases.googleImportDiscovery,
      transact: useCases.googleImportTransaction,
    }),
    performance: Object.freeze({
      get: useCases.getPropertyGooglePerformance,
      renewLease: useCases.renewGooglePerformanceLease,
    }),
  })

  // ── Review-facing adapter + webhook binder (BQC-5.2) ────────────
  // The JWT-verified GBP webhook may resolve the canonical location ID without
  // an organization ID. The lookup still delegates through the Property public API.
  const propertyLookup: PropertyLookupPort = {
    findByGbpLocationId: deps.propertyApi.findByGbpLocationId,
  }

  const googleReviewCursorStore =
    deps.googleReviewCursorStore ??
    (deps.providerEphemeralStore && deps.googleOpaqueReferenceKeys
      ? createGoogleReviewCursorStore({
          store: deps.providerEphemeralStore,
          keys: deps.googleOpaqueReferenceKeys,
          nowMs: () => deps.clock().getTime(),
        })
      : createUnavailableGoogleReviewCursorStore())

  const googleReviewSyncAuthorizer =
    deps.propertyBindingApi && deps.authorizeGoogleReviewSyncContent
      ? createGoogleReviewSyncAuthorizer({
          readBinding: deps.propertyBindingApi.readInternal,
          findConnection: connectionRepo.findById,
          getAccessToken: activeConnectionTokenProvider.getAccessToken,
          authorizeGoogleContent: deps.authorizeGoogleReviewSyncContent,
          warn: (fields, message) => deps.logger.warn(fields, message),
        })
      : null
  if (googleReviewSyncAuthorizer && deps.propertyBindingApi) {
    const propertyBindingApi = deps.propertyBindingApi
    authorizeGoogleNotificationProviderCall = async (
      organizationIdValue,
      connectionIdValue,
    ) => {
      const canonicalConnectionId = googleConnectionId(connectionIdValue)
      let connection
      try {
        connection = await connectionRepo.findById(
          organizationIdValue,
          canonicalConnectionId,
        )
      } catch {
        return { ok: false, code: 'authorization_unavailable' }
      }
      if (!connection) return { ok: false, code: 'connection_missing' }
      if (connection.status !== 'active' || connection.credentialUseState !== 'active') {
        return { ok: false, code: 'connection_inactive' }
      }

      let linkedPropertyIds: ReadonlyArray<string>
      try {
        linkedPropertyIds = await deps.propertyApi.findIdsByGoogleConnection(
          canonicalConnectionId,
          organizationIdValue,
        )
      } catch {
        return { ok: false, code: 'authorization_unavailable' }
      }
      const targets: Array<{
        accessToken: string
        authorization: GoogleReviewSyncProviderCallAuthorization
        gbpAccountId: string
      }> = []
      // Google's notification setting is account-scoped. Multiple active
      // Property bindings may share that account, so choose the first
      // lexicographically sorted Property whose exact binding/source epoch is
      // authorized, then issue one desired-state operation for the account.
      // This never invents broader account authority or selects an unbound
      // account from provider discovery.
      const targetedAccounts = new Set<string>()
      for (const linkedPropertyId of [...linkedPropertyIds].sort()) {
        const canonicalPropertyId = propertyId(linkedPropertyId)
        let binding
        try {
          binding = await propertyBindingApi.readInternal(
            organizationIdValue,
            canonicalPropertyId,
          )
        } catch {
          return { ok: false, code: 'authorization_unavailable' }
        }
        if (
          !binding ||
          binding.connectionId !== canonicalConnectionId ||
          !binding.accountId ||
          binding.state !== 'active' ||
          binding.lifecycleState !== 'active' ||
          binding.deletedAt !== null
        ) {
          continue
        }
        if (targetedAccounts.has(binding.accountId)) continue
        const authorized = await googleReviewSyncAuthorizer({
          organizationId: organizationIdValue,
          propertyId: canonicalPropertyId,
          connectionId: canonicalConnectionId,
          sourceEpoch: binding.sourceEpoch,
          operationKey: 'notifications.manage',
        })
        if (authorized.ok) {
          targetedAccounts.add(binding.accountId)
          targets.push({
            accessToken: authorized.accessToken,
            authorization: authorized.authorization,
            gbpAccountId: binding.accountId,
          })
          continue
        }
        if (authorized.code === 'runtime_unavailable') {
          return { ok: false, code: 'authorization_unavailable' }
        }
      }
      if (targets.length > 0) {
        return { ok: true, targets: Object.freeze(targets) }
      }
      return { ok: false, code: 'authorization_unavailable' }
    }
    reauthorizeGoogleNotificationProviderCall = async ({ authorization }) => {
      if (
        authorization.capability !== 'property.connect_gbp' ||
        authorization.initiatorUserId !== null
      ) {
        throw new Error('Google notification reauthorization is unavailable')
      }
      const refreshed = await googleReviewSyncAuthorizer({
        organizationId: authorization.organizationId,
        propertyId: authorization.propertyId,
        connectionId: authorization.connectionId,
        sourceEpoch: Number(authorization.authorizationVector.propertySourceEpoch),
        operationKey: 'notifications.manage',
      })
      if (
        !refreshed.ok ||
        refreshed.authorization.approvalBindingId !== authorization.approvalBindingId ||
        !sameAuthorizationVectorExceptCredentialGeneration(
          refreshed.authorization.authorizationVector,
          authorization.authorizationVector,
        )
      ) {
        throw new Error('Google notification reauthorization changed')
      }
      return refreshed.authorization
    }
  }
  const googleReplyPublicationAuthorizer =
    deps.propertyBindingApi && deps.authorizeGoogleReplyPublicationContent
      ? createGoogleReplyPublicationAuthorizer({
          readBinding: deps.propertyBindingApi.readInternal,
          findConnection: connectionRepo.findById,
          getAccessToken: activeConnectionTokenProvider.getAccessToken,
          authorizeGoogleContent: deps.authorizeGoogleReplyPublicationContent,
          warn: (fields, message) => deps.logger.warn(fields, message),
        })
      : null
  const authorizeGoogleReviewSyncProviderCall:
    | Parameters<
        typeof createGoogleReviewApiAdapter
      >[0]['authorizeReviewSyncProviderCall']
    | undefined = googleReviewSyncAuthorizer
    ? async (input) => {
        const authorized = await googleReviewSyncAuthorizer(input)
        if (!authorized.ok) {
          throw new Error(
            `Google review provider authorization is unavailable: ${authorized.code}`,
          )
        }
        return authorized
      }
    : undefined
  const authorizeGoogleReplyPublicationProviderCall:
    | Parameters<
        typeof createGoogleReviewApiAdapter
      >[0]['authorizeReplyPublicationProviderCall']
    | undefined = googleReplyPublicationAuthorizer
    ? async (input) => {
        const authorized = await googleReplyPublicationAuthorizer(input)
        if (!authorized.ok) {
          throw new Error(
            `Google reply publication authorization is unavailable: ${authorized.code}`,
          )
        }
        return authorized
      }
    : undefined
  const googleReviewProviderExecutor =
    deps.googleAuthorizedProviderExecutor &&
    (googleReviewSyncAuthorizer || googleReplyPublicationAuthorizer)
      ? createSingle401RefreshExecutor({
          executor: deps.googleAuthorizedProviderExecutor,
          refreshAccessToken: ({ authorization }) =>
            activeConnectionTokenProvider.forceRefreshAccessToken(
              authorization.organizationId,
              authorization.connectionId,
              authorization.expectedCredentialGeneration,
              authorization.propertyId ? [authorization.propertyId] : [],
            ),
          getAccessToken: ({ authorization }) =>
            activeConnectionTokenProvider.getAccessToken(
              authorization.organizationId,
              authorization.connectionId,
              authorization.propertyId ? [authorization.propertyId] : [],
            ),
          reauthorize: async ({ authorization }) => {
            if (authorization.initiatorUserId !== null) {
              throw new Error('Google review provider reauthorization is unavailable')
            }
            const refreshed =
              authorization.capability === 'property.connect_gbp' &&
              googleReviewSyncAuthorizer
                ? await googleReviewSyncAuthorizer({
                    organizationId: authorization.organizationId,
                    propertyId: authorization.propertyId,
                    connectionId: authorization.connectionId,
                    sourceEpoch: Number(
                      authorization.authorizationVector.propertySourceEpoch,
                    ),
                  })
                : authorization.capability === 'property.publish_reply' &&
                    googleReplyPublicationAuthorizer
                  ? await googleReplyPublicationAuthorizer({
                      organizationId: authorization.organizationId,
                      propertyId: authorization.propertyId,
                      connectionId: authorization.connectionId,
                      sourceEpoch: authorization.publication.sourceEpoch,
                      reviewId: authorization.publication.reviewId,
                      materialReviewRevision:
                        authorization.publication.materialReviewRevision,
                      replyId: authorization.publication.replyId,
                      publicationCycle: authorization.publication.publicationCycle,
                      attemptNumber: authorization.publication.attemptNumber,
                    })
                  : null
            if (
              !refreshed ||
              !refreshed.ok ||
              refreshed.authorization.approvalBindingId !==
                authorization.approvalBindingId ||
              !sameAuthorizationVectorExceptCredentialGeneration(
                refreshed.authorization.authorizationVector,
                authorization.authorizationVector,
              )
            ) {
              throw new Error('Google review provider reauthorization changed')
            }
            return refreshed.authorization
          },
        })
      : undefined

  // Integration owns the Google review API adapter (connection repo + token
  // encryption + refresh); the review context consumes it via its port.
  const googleReviewApi: GoogleReviewApiPort = createGoogleReviewApiAdapter({
    connectionRepo,
    encryption: encryptionPort,
    refreshToken: refreshGoogleTokenUseCase,
    logger: deps.logger,
    baseUrl: deps.providerEndpoints.reviewsApiBaseUrl,
    executor: googleReviewProviderExecutor,
    authorizeReviewSyncProviderCall: authorizeGoogleReviewSyncProviderCall,
    authorizeReplyPublicationProviderCall: authorizeGoogleReplyPublicationProviderCall,
    nowMs: () => deps.clock().getTime(),
    cursorStore: googleReviewCursorStore,
    ...(deps.assertDirectProviderEgressAllowed === undefined
      ? {}
      : { assertDirectEgressAllowed: deps.assertDirectProviderEgressAllowed }),
  })

  const googleReviewPushTargetResolver: TargetedGoogleReviewReferenceResolver =
    deps.propertyBindingApi
      ? createGoogleReviewPushTargetResolver({
          readBinding: deps.propertyBindingApi.readInternal,
          references: googleReviewPushReferences,
        })
      : Object.freeze({
          resolve: async () => ({ status: 'obsolete' as const }),
        })

  const gbpNotificationHandler = handleGbpNotification({
    propertyLookup,
    references: googleReviewPushReferences,
    receipts: gbpReviewPushReceipts,
    clock: deps.clock,
    logger: deps.logger,
  })

  return {
    publicApi,
    maintenance: Object.freeze({
      subscribeNotifications: useCases.gbpSubscribeBackfill,
      imports: Object.freeze({
        inspectBacklog: useCases.inspectGoogleImportV2Lifecycle,
        inspectScope: useCases.inspectGoogleImportV2LifecycleScope,
        inspectRequest: useCases.inspectGoogleImportV2Request,
        cancelRequest: useCases.cancelGoogleImportV2Request,
        sweep: useCases.sweepGoogleImportV2Lifecycle,
      }),
    }),
    lifecycle: Object.freeze({
      // LIF-01: the Organization Export contribution the Identity bundle builder
      // demands from this context. It is exposed here, beside the other
      // Organization-lifecycle capabilities, and never on `publicApi` — nothing
      // about exporting is reachable from a request surface.
      organizationExportContributor: createIntegrationOrganizationExportContributor(
        deps.db,
      ),
      // LIF-01-T12/T13/T14: the three destructive lifecycle phases. Exposing
      // the contributor does NOT arm it — the coordinator that calls `purge`
      // is composed only under an explicitly reviewed composition, and nothing
      // here reaches a request surface.
      organizationLifecycleContributor: createIntegrationOrganizationLifecycleContributor(
        {
          db: deps.db,
          provider: createGoogleOrganizationClosureProvider({
            oauth: oauthPort,
            encryption: encryptionPort,
            unsubscribeFromNotifications: manageNotificationsUseCase.unsubscribe,
          }),
        },
      ),
      prepareConnectorDeparture: useCases.prepareGoogleConnectorDeparture,
      cancelImportsForConnection: useCases.cancelGoogleImportV2ForConnection,
      cancelImportsForUser: useCases.cancelGoogleImportV2ForUser,
      cancelImportsForOrganization: useCases.cancelGoogleImportV2ForOrganization,
      preparePropertyDeletion: useCases.prepareGoogleImportV2PropertyDeletion,
      finalizePropertyDeletion: useCases.finalizeGoogleImportV2PropertyDeletion,
    }),
    webhook: Object.freeze({ handleNotification: gbpNotificationHandler }),
    worker: Object.freeze({
      registerOutboxConsumers,
      processImportItem: useCases.processGoogleImportV2Item,
      sweepImportLifecycle: useCases.sweepGoogleImportV2Lifecycle,
    }),
    // ARC-03-T12: the two provider capabilities the Review context consumes.
    // The root forwards this named group instead of reaching into `internal`.
    reviewSync: Object.freeze({
      googleReviewApi,
      googleReviewPushTargetResolver,
    }),
    internal: {
      repos: {
        connectionRepo,
        credentialLifecycle,
        googleOAuthExchangeRecovery,
        encryptionPort,
        oauthPort,
        gbpApiPort,
        loadImportItemRouting,
      },
      googleReviewApi,
      googleReviewPushTargetResolver,
      gbpNotificationHandler,
      useCases: {
        ...useCases,
      },
    },
  }
}
