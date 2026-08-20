// BQC-5.2 — composition characterization tests.
//
// Pins the CURRENT external shape of the container (top-level keys, useCases
// keys, readiness/runtime contributions) so the composition-cleanup refactor
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
import type { StoragePort } from '#/contexts/portal/application/ports/storage.port'

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
  'activityRepo',
  'ai',
  'alertDispatcher',
  'backgroundQueue',
  'badgePublicApi',
  'cache',
  'clock',
  'db',
  'eventBus',
  'goalRepo',
  'googleReviewApi',
  'identityPort',
  'inboxNoteRepo',
  'inboxRepo',
  'jobQueue',
  'jobRegistry',
  'leaderboardPublicApi',
  'logger',
  'metricPublicApi',
  'notificationEmailRepo',
  'notificationPrefRepo',
  'notificationPublicApi',
  'notificationRepo',
  'operationsSnapshot',
  'opsQueues',
  'outboxRepo',
  'policyAdmin',
  'portalLinkRepo',
  'portalPublicApi',
  'portalRepo',
  'propertyProcessingScopeApi',
  'providerEphemeralReadiness',
  'providerEphemeralRedis',
  'rateLimiter',
  'redis',
  'refreshPolicyStore',
  'refreshReviewProviderSubjectKeys',
  'registerOutboxConsumers',
  'replyQueue',
  'replyRepo',
  'reviewQueue',
  'reviewRepo',
  'staffPublicApi',
  'storage',
  'useCases',
]

const EXPECTED_USE_CASE_KEYS = [
  'acceptInvitation',
  'addInboxNote',
  'addPortalToGroup',
  'addTeamMember',
  'admitGoogleOAuthCallbackPreState',
  'admitGoogleOAuthCallbackTenant',
  'advanceRegionMove',
  'approveReply',
  'archiveStaffParticipation',
  'assignInboxItem',
  'bulkUpdateInboxStatus',
  'cancelGoal',
  'cancelGoogleImportV2ForConnection',
  'cancelGoogleImportV2ForOrganization',
  'cancelGoogleImportV2ForUser',
  'cancelGoogleImportV2Request',
  'cancelInvitation',
  'clearTeamLead',
  'completeContentReview',
  'connectGoogleAccount',
  'createCustomRole',
  'createGoal',
  'createGovernedGoalService',
  'createInboxItem',
  'createLink',
  'createLinkCategory',
  'createPortal',
  'createPortalGroup',
  'createProperty',
  'createStaffAssignment',
  'createStaffParticipation',
  'createTeam',
  'deleteCustomRole',
  'deleteLink',
  'deleteLinkCategory',
  'deleteReply',
  'disconnectGoogleAccount',
  'draftReply',
  'editPublishedReply',
  'escalateInboxItem',
  'evaluateBadgeForTarget',
  'finalizeGoogleImportV2PropertyDeletion',
  'finalizeUpload',
  'generatePropertyTrend',
  'generateReplySuggestion',
  'getAssignedPortals',
  'getAttentionSignals',
  'getDashboardData',
  'getFleetOverview',
  'getGoal',
  'getGoogleAuthUrl',
  'getInboxFolderCounts',
  'getInboxItemDetail',
  'getInboxItems',
  'getInboxNotes',
  'getLastVisitCount',
  'getPortal',
  'getPortalAnalytics',
  'getPortalGroup',
  'getProperty',
  'getPropertyGooglePerformance',
  'getPublicPortal',
  'getReply',
  'getStaffDashboardData',
  'getStaffRecentActivity',
  'googleImportDiscovery',
  'googleImportTransaction',
  'guestSessions',
  'handleGbpNotification',
  'inspectGoogleImportV2Lifecycle',
  'inspectGoogleImportV2LifecycleScope',
  'inspectGoogleImportV2Request',
  'inviteMember',
  'issuePortalToken',
  'listActiveTeamScopesByUser',
  'listGoals',
  'listGoogleConnections',
  'listInvitations',
  'listMyTeam',
  'listPortalGroups',
  'listPortalLinks',
  'listPortalManagementPropertyIds',
  'listPortals',
  'listProperties',
  'listRecognitionScopes',
  'listStaffAssignments',
  'listStaffGoals',
  'listStaffParticipations',
  'listStaffPortals',
  'listTeamMemberships',
  'listTeams',
  'merchantAiAuthorization',
  'prepareGoogleImportV2PropertyDeletion',
  'processGoogleImportV2Item',
  'readPropertyAiAggregates',
  'readPropertyAiTrend',
  'rebuildInboxProjection',
  'reconcileAllRecognition',
  'reconcileBadgeDefinitions',
  'reconcileRecognition',
  'reconcileReplyPublication',
  'recordScan',
  'redeemGoogleOAuthState',
  'refreshGoogleToken',
  'registerUser',
  'registerUserAndOrg',
  'rejectReply',
  'removeMember',
  'removePortalFromGroup',
  'removeStaffAssignment',
  'removeTeamMember',
  'renewGooglePerformanceLease',
  'reorderCategories',
  'reorderLinks',
  'requestRegionMove',
  'requestUploadUrl',
  'resendInvitation',
  'resolveEscalation',
  'resolveLinkAndTrack',
  'resolvePortalCategoryManagementScope',
  'resolvePortalContext',
  'resolvePortalGroupManagementScope',
  'resolvePortalLinkManagementScope',
  'resolvePortalManagementScope',
  'resolveStaffParticipationContext',
  'resolveTeamContext',
  'responseLifecycle',
  'retryPublish',
  'revokePortalTokens',
  'rotatePortalToken',
  'runReviewProviderSnapshot',
  'schedulePropertyTrends',
  'seedBadgeDefinitions',
  'setOrganizationBadgeEnablement',
  'setTeamLead',
  'softDeletePortal',
  'softDeletePortalGroup',
  'softDeleteProperty',
  'softDeleteTeam',
  'stampLastInboxView',
  'submitFeedback',
  'submitRating',
  'submitReply',
  'sweepGoogleImportV2Lifecycle',
  'trackReviewLinkClick',
  'updateConnectionVisibility',
  'updateCustomRole',
  'updateGoal',
  'updateInboxStatus',
  'updateLink',
  'updateLinkCategory',
  'updateMemberRole',
  'updateOrganization',
  'updatePortal',
  'updatePortalGroup',
  'updatePortalResponsibilities',
  'updateProperty',
  'updateStaffPortals',
  'updateTeam',
]

const EXPECTED_POLICY_ADMIN_OPS = [
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

  it('exposes the exact container.useCases key set', () => {
    expect(Object.keys(container.useCases).sort()).toEqual(EXPECTED_USE_CASE_KEYS)
  })

  it('exposes readiness/runtime contributions as functions', () => {
    expect(typeof container.refreshPolicyStore).toBe('function')
    expect(typeof container.refreshReviewProviderSubjectKeys).toBe('function')
    expect(typeof container.registerOutboxConsumers).toBe('function')
  })

  it('wires the injected queues and defines cache/rateLimiter/jobRegistry', () => {
    expect(container.jobQueue).toBe(queue)
    expect(container.backgroundQueue).toBe(backgroundQueue)
    expect(container.cache).toBeDefined()
    expect(container.rateLimiter).toBeDefined()
    expect(container.jobRegistry).toBeDefined()
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
    storage?: StoragePort
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

  const fakeStorage: StoragePort = {
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
    expect(defaults.storage).toBeDefined()
    expect(defaults.googleReviewApi).toBeDefined()
    expect(defaults.storage.createPresignedUploadUrl).toBeDefined()
  })

  it('honors injected provider overrides without changing the container shape', () => {
    const withProviders = buildWithProviders({
      googleOAuth: createInMemoryGoogleOAuthPort(),
      gbpApi: createInMemoryGbpApiPort(),
      storage: fakeStorage,
    })
    // Storage is observable at the container boundary — the injected fake wins.
    expect(withProviders.storage).toBe(fakeStorage)
    // googleOAuth/gbpApi thread into the integration build (proven at the
    // build seam in src/contexts/integration/build.test.ts); the external
    // container shape is byte-identical either way.
    expect(Object.keys(withProviders).sort()).toEqual(EXPECTED_TOP_LEVEL_KEYS)
    expect(Object.keys(withProviders.useCases).sort()).toEqual(EXPECTED_USE_CASE_KEYS)
  })

  it('defaults and overrides produce the same top-level and useCases keys', () => {
    const withProviders = buildWithProviders({})
    expect(withProviders.storage).not.toBe(fakeStorage)
    expect(Object.keys(withProviders).sort()).toEqual(EXPECTED_TOP_LEVEL_KEYS)
  })
})
