import { beforeAll, describe, expect, it } from 'vitest'
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
  'listInvitations',
  'merchantAiAuthorization',
  'registerInvitedUser',
  'registerUserAndOrg',
  'removeMember',
  'resendInvitation',
  'updateCustomRole',
  'updateMemberRole',
  'updateOrganization',
] as const

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
      'requests',
    ])
    expect(Object.keys(api.managerFacts)).toEqual(['listActiveManagers'])
    expect(Object.keys(api.accountAdminAuthority)).toEqual(['isCurrentAccountAdmin'])
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
    expect(Object.isFrozen(api.requests)).toBe(true)
    expect(Object.isFrozen(api.requests.merchantAiAuthorization)).toBe(true)
  })
})
