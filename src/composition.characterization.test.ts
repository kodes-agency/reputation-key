// BQC-5.2 — composition characterization tests.
//
// Pins the CURRENT external shape of the container (top-level keys, named
// capability keys, readiness/runtime contributions) so the composition-cleanup refactor
// can prove behavior parity: these tests must pass unchanged before and after
// each per-context cluster move.
//
// Construction must be query-free (repos/adapters are lazy factories), so the
// DB is a Proxy that throws on any access — an eager query during
// createContainer fails the suite. Deterministic backends mirror
// shared/testing/simulation-container.server.ts (in-memory queue, fixed
// clock, in-memory identity fake, captured email).

import { describe, it, expect, beforeAll } from 'vitest'
import { createContainer, type Container } from '#/composition'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import { createInMemoryQueue, type InMemoryQueue } from '#/shared/testing/in-memory-queue'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createInMemoryGbpApiPort } from '#/shared/testing/in-memory-gbp-api-port'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { PortalStoragePort } from '#/contexts/portal/application/ports/storage.port'

const FIXED_DATE = new Date('2026-01-15T12:00:00.000Z')

/** Query-free guard: any DB access during construction throws. */
const dbStub = new Proxy(
  {},
  {
    get: () => {
      throw new Error('composition must not query the DB during construction')
    },
  },
) as unknown as Database

const EXPECTED_TOP_LEVEL_KEYS = [
  'activityPublicApi',
  'activityWorkerRuntime',
  'aiPublicApi',
  'aiWorkerRuntime',
  'alertDispatcher',
  'assetStorage',
  'backgroundQueue',
  'betaFeedbackTriageRepo',
  'cache',
  // ARC-03-T8: the policy trio is container-owned. Building a container no
  // longer installs it process-wide; one entry point binds one container.
  'capabilityPolicyStore',
  'clock',
  // ARC-03-T7: the durable outbox consumer registry is container-owned, so two
  // containers in one process can each register the same consumers.
  'consumerRegistry',
  'dashboardPublicApi',
  'dataCellExecutionFence',
  'db',
  'delayedExecutionPolicy',
  'eventBus',
  'executionPolicy',
  'goalPublicApi',
  'goalWorkerRuntime',
  'guestContactRequestRetentionSweep',
  'guestPublicApi',
  'handleResendEvent',
  'idGen',
  'identityLifecycleRuntime',
  'identityPort',
  'identityPublicApi',
  'identityRequestSecurity',
  'identityWorkerRuntime',
  'inboxLifecycleRuntime',
  'inboxMaintenanceRuntime',
  'inboxPublicApi',
  'inboxRuntime',
  'integrationLifecycleRuntime',
  'integrationMaintenanceRuntime',
  'integrationPublicApi',
  'integrationWebhookRuntime',
  'integrationWorkerRuntime',
  // ARC-03-T15: worker-owned dispatch handles (quarantine barrier queue,
  // domain-events publication handle, the ONE processing router). The worker
  // entry point used to build these itself, outside any container.
  'jobDispatchWorkerRuntime',
  'jobQueue',
  'jobRegistry',
  'logger',
  'metricMaintenanceRuntime',
  'metricPublicApi',
  'notificationAudienceAuthorizer',
  'notificationDeliverySettlement',
  'notificationPublicApi',
  'notificationWorkerRuntime',
  'operationsSnapshot',
  'opsQueues',
  'outboxRepo',
  'policyAdmin',
  'pool',
  'portalPublicApi',
  'portalWorkerRuntime',
  'propertyPublicApi',
  'providerEphemeralReadiness',
  'providerEphemeralRedis',
  'rateLimiter',
  // Self-heals inbox items whose notification never got written, so a swallowed
  // in-process bus failure stops being permanent data loss.
  'reconcileMissingNotificationsHandler',
  'redis',
  'refreshPolicyStore',
  'refreshReviewProviderSubjectKeys',
  'registerOutboxConsumers',
  'registerReviewWorkerJobs',
  'reviewMaintenanceRuntime',
  'reviewPublicApi',
  // ARC-03-T6: the container's owned release seam — building a container
  // starts the identity policy poller, so stopping it must be reachable from
  // the container itself rather than from a dropped return value.
  'shutdown',
  'staffPublicApi',
]

const EXPECTED_INBOX_PUBLIC_API_KEYS = [
  'addInboxNote',
  'assignInboxItem',
  'bulkAssignInboxItems',
  'bulkUpdateInboxStatus',
  'correctFeedbackHandlingOutcome',
  'escalateInboxItem',
  'getGoogleReviewTargetAnalytics',
  // S5: per-property overdue Response Target counts — the Dashboard's only
  // response-timer authority.
  'getGoogleReviewTargetCountsByProperty',
  'getInboxFolderCounts',
  'getInboxItemDetail',
  // IBX-01-T5: the manager Handling History read.
  'getInboxItemHistory',
  'getInboxItems',
  'getInboxNotes',
  'getLastVisitCount',
  'getPrivateFeedbackTargetAnalytics',
  'getResponseTargetPolicySettings',
  'markFeedbackHandled',
  'resolveEscalation',
  'setResponseTargetPolicy',
  'stampLastInboxView',
  'updateInboxStatus',
] as const

const EXPECTED_POLICY_ADMIN_OPS = [
  'explainCapabilityRefusal',
  'explainPolicyDecision',
  'getOrgPolicyState',
  'getRegionDiagnostic',
  'grantPropertyAccessOp',
  'revokePropertyAccessOp',
  'setOrgCapability',
  'setOrgSuspension',
  'setPropertyCapability',
  'setPropertySuspension',
]

describe('composition characterization (BQC-5.2 parity baseline)', () => {
  let container: Container
  let queue: InMemoryQueue
  let backgroundQueue: InMemoryQueue

  beforeAll(() => {
    const clock: Clock = () => FIXED_DATE
    queue = createInMemoryQueue({ clock })
    backgroundQueue = createInMemoryQueue({ clock })
    container = createContainer({
      clock,
      queue,
      backgroundQueue,
      // BQC-5.5: ops queue read handles are container-owned; inject in-memory
      // fakes so construction never opens real Redis connections.
      opsDomainEventsQueue: createInMemoryQueue({ clock }),
      opsQuarantineQueue: createInMemoryQueue({ clock }),
      redis: undefined,
      enableJobs: true,
      db: dbStub,
      identityPort: createInMemoryIdentityPort(),
      email: async () => {},
    })
  })

  it('exposes the exact top-level container key set', () => {
    expect(Object.keys(container).sort()).toEqual(EXPECTED_TOP_LEVEL_KEYS)
  })

  it('exposes the exact frozen Inbox request capability set', () => {
    expect(Object.keys(container.inboxPublicApi).sort()).toEqual(
      EXPECTED_INBOX_PUBLIC_API_KEYS,
    )
    expect(Object.isFrozen(container.inboxPublicApi)).toBe(true)
  })

  it('does not expose a catch-all use-case service locator', () => {
    expect(container).not.toHaveProperty('useCases')
  })

  it('does not expose simulation mutation authority on an application container', () => {
    expect(container).not.toHaveProperty('simulationRuntime')
  })

  it('keeps Metric lifetime mutations outside the public API', () => {
    expect(Object.keys(container.metricPublicApi.portalLifetime)).toEqual(['get'])
    expect(Object.isFrozen(container.metricPublicApi.portalLifetime)).toBe(true)
    expect(Object.keys(container.metricMaintenanceRuntime)).toEqual([
      'repairPortalLifetime',
    ])
  })

  it('exposes exact frozen Integration capabilities by workflow', () => {
    expect(Object.keys(container.integrationPublicApi).sort()).toEqual([
      'connections',
      'imports',
      'oauth',
      'performance',
    ])
    expect(Object.keys(container.integrationPublicApi.connections).sort()).toEqual([
      'connect',
      'disconnect',
      'list',
      'resume',
      'updateVisibility',
    ])
    expect(Object.keys(container.integrationPublicApi.oauth).sort()).toEqual([
      'admitPreState',
      'admitResolvedTenant',
      'getAuthorizationUrl',
      'redeemState',
    ])
    expect(Object.keys(container.integrationMaintenanceRuntime).sort()).toEqual([
      'imports',
      'subscribeNotifications',
    ])
    expect(Object.keys(container.integrationLifecycleRuntime).sort()).toEqual([
      'cancelImportsForConnection',
      'cancelImportsForOrganization',
      'cancelImportsForUser',
      'finalizePropertyDeletion',
      'organizationExportContributor',
      'organizationLifecycleContributor',
      'prepareConnectorDeparture',
      'preparePropertyDeletion',
    ])
    expect(Object.keys(container.integrationWebhookRuntime)).toEqual([
      'handleNotification',
    ])
    expect(Object.keys(container.integrationWorkerRuntime).sort()).toEqual([
      'processImportItem',
      'registerOutboxConsumers',
      'sweepImportLifecycle',
    ])

    expect(Object.isFrozen(container.integrationPublicApi)).toBe(true)
    expect(Object.isFrozen(container.integrationPublicApi.connections)).toBe(true)
    expect(Object.isFrozen(container.integrationPublicApi.oauth)).toBe(true)
    expect(Object.isFrozen(container.integrationPublicApi.imports)).toBe(true)
    expect(Object.isFrozen(container.integrationPublicApi.performance)).toBe(true)
    expect(Object.isFrozen(container.integrationMaintenanceRuntime)).toBe(true)
    expect(Object.isFrozen(container.integrationMaintenanceRuntime.imports)).toBe(true)
    expect(Object.isFrozen(container.integrationLifecycleRuntime)).toBe(true)
    expect(Object.isFrozen(container.integrationWebhookRuntime)).toBe(true)
    expect(Object.isFrozen(container.integrationWorkerRuntime)).toBe(true)
  })

  it('exposes exact frozen Inbox lifecycle and maintenance capabilities', () => {
    expect(Object.keys(container.inboxLifecycleRuntime).sort()).toEqual([
      'createInboxItem',
      'getInboxResponseTarget',
      'startReviewHandlingCycle',
    ])
    expect(Object.keys(container.inboxMaintenanceRuntime)).toEqual([
      'rebuildInboxProjection',
    ])
    expect(Object.isFrozen(container.inboxLifecycleRuntime)).toBe(true)
    expect(Object.isFrozen(container.inboxMaintenanceRuntime)).toBe(true)
  })

  it('owns a frozen policy trio without installing it process-wide', () => {
    expect(Object.isFrozen(container.capabilityPolicyStore)).toBe(true)
    expect(Object.isFrozen(container.executionPolicy)).toBe(true)
    expect(Object.isFrozen(container.delayedExecutionPolicy)).toBe(true)
  })

  it('exposes readiness/runtime contributions as functions', () => {
    expect(typeof container.refreshPolicyStore).toBe('function')
    expect(typeof container.refreshReviewProviderSubjectKeys).toBe('function')
    expect(typeof container.registerOutboxConsumers).toBe('function')
    expect(typeof container.registerReviewWorkerJobs).toBe('function')
  })

  it('keeps the named Organization lifecycle runtime non-executable without reviewed bindings', () => {
    // Destructive lifecycle still has no contributors: those are supplied only
    // by an explicitly reviewed composition, never by default.
    expect(container.identityLifecycleRuntime.maintenance.readiness).toMatchObject({
      configured: false,
      contributorsConfigured: false,
      supportAuthorizationConfigured: false,
    })
    expect(
      container.identityLifecycleRuntime.maintenance.readiness.missingContexts,
    ).toHaveLength(17)
    expect(
      container.identityLifecycleRuntime.maintenance.runScheduledPass,
    ).toBeUndefined()
    expect(container.identityLifecycleRuntime.support).toBeUndefined()

    // LIF-01-T11: export contributor coverage is now complete by default,
    // because reading nothing and writing nothing is not an activation. The
    // export service is still absent — egress needs storage, the archive
    // writer, the retrieval-secret binding and generation recovery, none of
    // which a default container supplies.
    expect(container.identityLifecycleRuntime.organizationExport.readiness).toMatchObject(
      {
        configured: false,
        contributorsConfigured: true,
        storageConfigured: false,
      },
    )
    expect(
      container.identityLifecycleRuntime.organizationExport.readiness.missingContexts,
    ).toHaveLength(0)
    expect(container.identityLifecycleRuntime.organizationExport.service).toBeUndefined()
  })

  it('wires the injected queues and defines cache/rateLimiter/jobRegistry', () => {
    expect(container.jobQueue).toBe(queue)
    expect(container.backgroundQueue).toBe(backgroundQueue)
    expect(container.cache).toBeDefined()
    expect(container.rateLimiter).toBeDefined()
    expect(container.jobRegistry).toBeDefined()
    expect(container.redis).toBeUndefined()
  })

  it('exposes policyAdmin with its operation keys', () => {
    expect(container.policyAdmin).toBeDefined()
    expect(Object.keys(container.policyAdmin).sort()).toEqual(EXPECTED_POLICY_ADMIN_OPS)
  })
})

describe('provider DI slots (BQC-6.1)', () => {
  // Build a second container with the same deterministic backends plus the
  // provider overrides under test.
  function buildWithProviders(providers: {
    googleOAuth?: ReturnType<typeof createInMemoryGoogleOAuthPort>
    gbpApi?: ReturnType<typeof createInMemoryGbpApiPort>
    storage?: PortalStoragePort
  }): Container {
    const clock: Clock = () => FIXED_DATE
    // createContainer registers all event schemas at construction; the
    // registry is process-global and single-shot, so each additional
    // construction in this describe starts from a clean registry.
    clearEventSchemas()
    return createContainer({
      clock,
      queue: createInMemoryQueue({ clock }),
      backgroundQueue: createInMemoryQueue({ clock }),
      opsDomainEventsQueue: createInMemoryQueue({ clock }),
      opsQuarantineQueue: createInMemoryQueue({ clock }),
      redis: undefined,
      enableJobs: true,
      db: dbStub,
      identityPort: createInMemoryIdentityPort(),
      email: async () => {},
      providers,
    })
  }

  const fakeStorage: PortalStoragePort = {
    createIssuedPortalUpload: async () => ({
      uploadUrl: 'memory://upload',
      requiredHeaders: { 'If-None-Match': '*' },
    }),
    confirmIssuedPortalUpload: async (issuance) => ({
      contentType: issuance.contentType,
      sizeBytes: issuance.declaredSizeBytes,
      sourceETag: '"d41d8cd98f00b204e9800998ecf8427e"',
    }),
    readIssuedPortalUpload: async () => Buffer.alloc(0),
    writePortalUploadDerivative: async (issuance, derivative) => {
      const objectKey = `public/portal-heroes/${issuance.id}/${derivative}.webp`
      return { objectKey, publicUrl: `memory://${objectKey}` }
    },
    deleteIssuedPortalUpload: async () => {},
    deletePortalUploadDerivative: async () => {},
    createPresignedUploadUrl: async (key) => ({ uploadUrl: 'memory://upload', key }),
    confirmUpload: async (key) => `memory://${key}`,
    deleteObject: async () => {},
    getPublicUrl: (key) => `memory://${key}`,
    putObject: async () => {},
  }

  it('leaves defaults unchanged when no providers are injected', () => {
    // Built WITHOUT providers: same pinned shape; the default env-driven
    // adapters are present.
    const defaults = buildWithProviders({})
    expect(defaults.assetStorage).toBeDefined()
    expect(defaults.assetStorage.createPresignedUploadUrl).toBeDefined()
  })

  it('honors injected provider overrides without changing the container shape', () => {
    const withProviders = buildWithProviders({
      googleOAuth: createInMemoryGoogleOAuthPort(),
      gbpApi: createInMemoryGbpApiPort(),
      storage: fakeStorage,
    })
    // Storage is observable at the container boundary — the injected fake wins.
    expect(withProviders.assetStorage).toBe(fakeStorage)
    // googleOAuth/gbpApi thread into the integration build (proven at the
    // build seam in src/contexts/integration/build.test.ts); the external
    // container shape is byte-identical either way.
    expect(Object.keys(withProviders).sort()).toEqual(EXPECTED_TOP_LEVEL_KEYS)
  })

  it('defaults and overrides produce the same top-level keys', () => {
    const withProviders = buildWithProviders({})
    expect(withProviders.assetStorage).not.toBe(fakeStorage)
    expect(Object.keys(withProviders).sort()).toEqual(EXPECTED_TOP_LEVEL_KEYS)
  })
})
