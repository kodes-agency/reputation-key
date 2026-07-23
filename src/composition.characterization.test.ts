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
  'outboxRepo',
  'policyAdmin',
  'portalLinkRepo',
  'portalPublicApi',
  'portalRepo',
  'rateLimiter',
  'redis',
  'refreshPolicyStore',
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
  'advanceRegionMove',
  'approveReply',
  'assignInboxItem',
  'bulkUpdateInboxStatus',
  'cancelGoal',
  'cancelInvitation',
  'connectGoogleAccount',
  'createCustomRole',
  'createGoal',
  'createInboxItem',
  'createLink',
  'createLinkCategory',
  'createPortal',
  'createPortalGroup',
  'createProperty',
  'createStaffAssignment',
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
  'finalizeUpload',
  'getAssignedPortals',
  'getAttentionSignals',
  'getDashboardData',
  'getFleetOverview',
  'getGoal',
  'getGoogleAuthUrl',
  'getImportStatus',
  'getInboxFolderCounts',
  'getInboxItemDetail',
  'getInboxItems',
  'getInboxNotes',
  'getLastVisitCount',
  'getPortal',
  'getPortalAnalytics',
  'getPortalGroup',
  'getPortalQrUrl',
  'getProperty',
  'getPublicPortal',
  'getReply',
  'getStaffDashboardData',
  'getStaffRecentActivity',
  'handleGbpNotification',
  'importProperty',
  'inviteMember',
  'listGbpLocations',
  'listGoals',
  'listGoogleConnections',
  'listInvitations',
  'listPortalGroups',
  'listPortalLinks',
  'listPortals',
  'listProperties',
  'listStaffAssignments',
  'listStaffGoals',
  'listStaffPortals',
  'listTeams',
  'rebuildInboxProjection',
  'reconcileBadgeDefinitions',
  'reconcileLeaderboards',
  'reconcileReplyPublication',
  'recordScan',
  'refreshGoogleToken',
  'refreshLeaderboard',
  'registerUser',
  'registerUserAndOrg',
  'rejectReply',
  'removeMember',
  'removePortalFromGroup',
  'removeStaffAssignment',
  'reorderCategories',
  'reorderLinks',
  'requestRegionMove',
  'requestUploadUrl',
  'resendInvitation',
  'resolveEscalation',
  'resolveLinkAndTrack',
  'resolvePortalContext',
  'retryPublish',
  'seedBadgeDefinitions',
  'setOrganizationBadgeEnablement',
  'softDeletePortal',
  'softDeletePortalGroup',
  'softDeleteProperty',
  'softDeleteTeam',
  'stampLastInboxView',
  'startPropertyImport',
  'submitFeedback',
  'submitRating',
  'submitReply',
  'syncReviews',
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
