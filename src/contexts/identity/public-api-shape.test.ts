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
  'inviteMember',
  // LIF-01-T21: leaving is its own operation, not a variant of removeMember.
  'leaveOrganization',
  'listInvitations',
  'merchantAiAuthorization',
  'registerInvitedUser',
  'removeMember',
  'resendInvitation',
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
    expect(Object.keys(api.managerFacts)).toEqual(['listActiveManagers'])
    expect(Object.keys(api.accountAdminAuthority)).toEqual(['isCurrentAccountAdmin'])
    expect(Object.keys(api.offboardingFacts)).toEqual(['listOutstanding'])
    expect(Object.keys(api.people).sort()).toEqual([
      'findActiveParticipation',
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
      'enable',
      'get',
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
})
