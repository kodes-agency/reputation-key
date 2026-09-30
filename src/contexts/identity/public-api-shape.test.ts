import { beforeAll, describe, expect, it, beforeEach } from 'vitest'
import { clearTestContainerEnv } from '#/shared/testing/clear-container-env'
import { createContainer, type Container } from '#/composition'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import { createInMemoryQueue } from '#/shared/testing/in-memory-queue'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { buildIdentityContext } from './build'
import type { MemberOffboarding } from './application/use-cases/leave-organization'

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
  // LIF-01-T21: leaving is its own operation, not a variant of removeMember.
  'leaveOrganization',
  'listInvitations',
  // AccountAdmins edit a PropertyManager's Properties from Members.
  'listMemberPropertyAccess',
  'merchantAiAuthorization',
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
      'offboardingFacts',
      'people',
      'requests',
    ])
    expect(Object.keys(api.managerFacts)).toEqual([
      'listActiveManagers',
      'canApproveReplies',
    ])
    expect(Object.keys(api.accountAdminAuthority)).toEqual(['isCurrentAccountAdmin'])
    expect(Object.keys(api.offboardingFacts)).toEqual([
      'listOutstanding',
      'selfServiceLeaveAvailable',
    ])
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

    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.isFrozen(api.managerFacts)).toBe(true)
    expect(Object.isFrozen(api.accountAdminAuthority)).toBe(true)
    expect(Object.isFrozen(api.offboardingFacts)).toBe(true)
    expect(Object.isFrozen(api.people)).toBe(true)
    expect(Object.isFrozen(api.people.management)).toBe(true)
    expect(Object.isFrozen(api.requests)).toBe(true)
    expect(Object.isFrozen(api.requests.merchantAiAuthorization)).toBe(true)
  })

  /**
   * wiring-03. docs/operations/organization-lifecycle.md states that production
   * composes no `memberOffboarding` adapter, so self-service leave refuses and
   * removal by an AccountAdmin is the supported path. The availability fact
   * must say exactly that, and the fail-closed worklist read must still refuse.
   */
  it('reports self-service leave unavailable: the application container composes no offboarding facts', async () => {
    const facts = container.identityPublicApi.offboardingFacts

    expect(facts.selfServiceLeaveAvailable).toBe(false)
    await expect(facts.listOutstanding('org-1', 'user-1')).rejects.toMatchObject({
      _tag: 'IdentityError',
      code: 'forbidden',
    })
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
})

describe('Identity self-service leave availability', () => {
  const composedOffboarding: MemberOffboarding = {
    listOutstanding: async () => [],
    isEligibleRecipient: async () => true,
    transfer: async () => {},
  }

  const buildWith = (memberOffboarding?: MemberOffboarding) =>
    buildIdentityContext({
      db: dbStub,
      identityPort: createInMemoryIdentityPort(),
      clock: () => FIXED_DATE,
      idGen: () => '00000000-0000-4000-8000-000000000001',
      authSession: {
        setActiveOrganization: async () => {},
        updateOrganization: async () => {},
        currentOrganizationName: async () => null,
        verifyPassword: async () => false,
      },
      sendEmail: async () => {},
      baseUrl: 'https://app.example.test',
      invitationExpiresInMs: 60_000,
      propertyNames: async () => [],
      logger: createMockLogger(),
      betaFeedbackHmacSecret: 'test-beta-feedback-pseudonym-secret',
      policy: { env: {}, propertyBelongsToOrganization: async () => true },
      ...(memberOffboarding ? { memberOffboarding } : {}),
    }).publicApi.offboardingFacts

  it('follows the wiring: available only once an offboarding adapter is composed', async () => {
    expect(buildWith().selfServiceLeaveAvailable).toBe(false)

    const composed = buildWith(composedOffboarding)
    expect(composed.selfServiceLeaveAvailable).toBe(true)
    await expect(composed.listOutstanding('org-1', 'user-1')).resolves.toEqual([])
  })
})
