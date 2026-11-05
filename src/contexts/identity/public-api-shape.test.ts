import { beforeAll, describe, expect, it, beforeEach } from 'vitest'
import { clearTestContainerEnv } from '#/shared/testing/clear-container-env'
import { createContainer, type Container } from '#/composition'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import { createInMemoryQueue } from '#/shared/testing/in-memory-queue'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'

const FIXED_DATE = new Date('2026-01-15T12:00:00.000Z')

const dbStub = new Proxy(
  {},
  {
    get: () => {
      throw new Error('Identity public API construction must not query the database')
    },
  },
) as unknown as Database

const EXPECTED_REQUEST_KEYS = [
  'acceptInvitation',
  'cancelInvitation',
  'createCustomRole',
  'deleteCustomRole',
  // The invitation link's anonymous preview (ADR 0062).
  'getInvitationPreview',
  'inviteMember',
  'listInvitations',
  // AccountAdmins edit a PropertyManager's Properties from Members.
  'listMemberPropertyAccess',
  'merchantAiAuthorization',
  // AccountAdmins: the after-the-fact announcement of an automatic AI renewal.
  'merchantAiNoticeUpdates',
  'registerInvitedUser',
  'removeMember',
  'resendInvitation',
  'setMemberPropertyAccess',
  'updateCustomRole',
  'updateMemberRole',
  'updateOrganization',
] as const

beforeEach(clearTestContainerEnv)

describe('Identity public API', () => {
  let container: Container

  beforeAll(() => {
    const clock: Clock = () => FIXED_DATE
    container = createContainer({
      clock,
      db: dbStub,
      queue: createInMemoryQueue({ clock }),
      backgroundQueue: createInMemoryQueue({ clock }),
      opsDomainEventsQueue: createInMemoryQueue({ clock }),
      opsQuarantineQueue: createInMemoryQueue({ clock }),
      redis: undefined,
      enableJobs: true,
      identityPort: createInMemoryIdentityPort(),
      email: async () => {},
    })
  })

  it('exposes exact, frozen fact, authority, and request facades', () => {
    const api = container.identityPublicApi

    expect(Object.keys(api).sort()).toEqual([
      'accountAdminAuthority',
      'managerFacts',
      'people',
      'requests',
      'staffAccounts',
      'staffSelf',
    ])
    expect(Object.keys(api.managerFacts)).toEqual([
      'listActiveManagers',
      'canApproveReplies',
    ])
    expect(Object.keys(api.accountAdminAuthority)).toEqual(['isCurrentAccountAdmin'])
    expect(Object.keys(api.people).sort()).toEqual([
      'findParticipationById',
      'getAccessiblePropertyIds',
      'getAssignedPortals',
      'listActiveParticipations',
      'management',
      'resolvePrimaryStaffAttribution',
    ])
    expect(Object.keys(api.people.management).sort()).toEqual([
      'archiveStaffParticipation',
      'createStaffParticipation',
      'listStaffParticipations',
      'updatePortalResponsibilities',
    ])
    expect(Object.keys(api.requests).sort()).toEqual(EXPECTED_REQUEST_KEYS)
    expect(Object.keys(api.requests.merchantAiAuthorization).sort()).toEqual([
      'change',
      'defer',
      'enable',
      'enableForProperties',
      'get',
      'listOverview',
      'revoke',
    ])
    expect(Object.keys(api.requests.merchantAiNoticeUpdates).sort()).toEqual([
      'get',
      'latest',
      'markSeen',
    ])

    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.isFrozen(api.managerFacts)).toBe(true)
    expect(Object.isFrozen(api.accountAdminAuthority)).toBe(true)
    expect(Object.isFrozen(api.people)).toBe(true)
    expect(Object.isFrozen(api.people.management)).toBe(true)
    expect(Object.isFrozen(api.requests)).toBe(true)
    expect(Object.isFrozen(api.requests.merchantAiAuthorization)).toBe(true)
    expect(Object.isFrozen(api.requests.merchantAiNoticeUpdates)).toBe(true)
  })

  it('exposes beta feedback as its own frozen request capability, off publicApi', () => {
    // Other contexts receive publicApi; only the reporter's two requests
    // reach the triage store, never its operator workflow.
    expect(Object.keys(container.identityBetaFeedback).sort()).toEqual([
      'listMine',
      'submit',
    ])
    expect(Object.isFrozen(container.identityBetaFeedback)).toBe(true)
    expect(container.identityPublicApi).not.toHaveProperty('betaFeedback')
    expect(container).not.toHaveProperty('betaFeedbackTriageRepo')
  })

  it('exposes the platform operator console as its own frozen capability, off publicApi', () => {
    // ADR 0065: only the console's server functions reach it, after
    // requirePlatformOperator; no other context ever receives it.
    expect(Object.keys(container.identityPlatform).sort()).toEqual([
      'cancelInvitation',
      'inviteAdmin',
      'listOrganizations',
      'provisionOrganization',
      'resendInvitation',
    ])
    expect(Object.isFrozen(container.identityPlatform)).toBe(true)
    expect(container.identityPublicApi).not.toHaveProperty('platform')
    expect(container.identityPublicApi.requests).not.toHaveProperty(
      'provisionOrganization',
    )
  })
})
