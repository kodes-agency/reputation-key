import { describe, expect, it, vi } from 'vitest'
import { propertyId, userId } from '#/shared/domain/ids'
import { createContactRequestManagerAuthorityAdapter } from './contact-request-manager-authority.adapter'

const SCOPE = Object.freeze({
  organizationId: 'org-contact-manager',
  propertyId: '20000000-0000-4000-8000-000000000001',
  portalId: '20000000-0000-4000-8000-000000000002',
})
const NOW = new Date('2026-08-28T12:00:00.000Z')

const setup = (overrides?: {
  facts?: {
    propertyId: string
    creatorUserId: string | null
    responsibleManagerUserIds: readonly string[]
  } | null
  accountAdmin?: boolean
  managers?: readonly {
    userId: string
    role: 'AccountAdmin' | 'PropertyManager'
    propertyAccessScope: 'organization' | 'assigned-properties'
  }[]
  accessible?: readonly string[] | null
}) => {
  const portal = {
    getContactRequestManagerAuthorityFacts: vi.fn(async () => {
      const facts =
        overrides?.facts === undefined
          ? {
              propertyId: SCOPE.propertyId,
              creatorUserId: 'creator-1',
              responsibleManagerUserIds: ['manager-1'],
            }
          : overrides.facts
      return facts
        ? {
            propertyId: propertyId(facts.propertyId),
            creatorUserId: facts.creatorUserId ? userId(facts.creatorUserId) : null,
            responsibleManagerUserIds: facts.responsibleManagerUserIds.map(userId),
          }
        : null
    }),
  }
  const identity = {
    isCurrentAccountAdmin: vi.fn(async () => overrides?.accountAdmin ?? false),
    listActiveManagers: vi.fn(
      async () =>
        overrides?.managers ?? [
          {
            userId: 'creator-1',
            role: 'PropertyManager' as const,
            propertyAccessScope: 'assigned-properties' as const,
          },
          {
            userId: 'manager-1',
            role: 'PropertyManager' as const,
            propertyAccessScope: 'assigned-properties' as const,
          },
        ],
    ),
  }
  const staff = {
    getAccessiblePropertyIds: vi.fn(
      async () => (overrides?.accessible ?? [SCOPE.propertyId])?.map(propertyId) ?? null,
    ),
  }
  return {
    authority: createContactRequestManagerAuthorityAdapter({
      portal,
      managerFacts: identity,
      accountAdminAuthority: identity,
      staff,
    }),
    portal,
    identity,
    staff,
  }
}

const resolve = (actorId: string) => ({ scope: SCOPE, actorId, at: NOW })

describe('Contact Request manager authority adapter', () => {
  it('resolves a current AccountAdmin only after the exact Portal scope exists', async () => {
    const { authority, portal, identity, staff } = setup({ accountAdmin: true })

    await expect(authority.resolve(resolve('admin-1'))).resolves.toBe('account_admin')
    expect(portal.getContactRequestManagerAuthorityFacts).toHaveBeenCalledWith(
      SCOPE.organizationId,
      SCOPE.portalId,
    )
    expect(identity.isCurrentAccountAdmin).toHaveBeenCalledWith({
      organizationId: SCOPE.organizationId,
      userId: 'admin-1',
    })
    expect(staff.getAccessiblePropertyIds).not.toHaveBeenCalled()
  })

  it.each([
    ['creator-1', 'portal_creator'],
    ['manager-1', 'responsible_manager'],
  ] as const)(
    'resolves current PropertyManager %s through fresh membership and exact Property access',
    async (actorId, expectedBasis) => {
      const { authority, identity, staff } = setup()

      await expect(authority.resolve(resolve(actorId))).resolves.toBe(expectedBasis)
      expect(identity.listActiveManagers).toHaveBeenCalledWith(SCOPE.organizationId)
      expect(staff.getAccessiblePropertyIds).toHaveBeenCalledWith(
        SCOPE.organizationId,
        actorId,
        false,
      )
    },
  )

  it.each([
    ['missing Portal', { facts: null }],
    [
      'Property mismatch',
      {
        facts: {
          propertyId: '20000000-0000-4000-8000-000000000099',
          creatorUserId: 'creator-1',
          responsibleManagerUserIds: ['manager-1'],
        },
      },
    ],
    ['missing membership', { managers: [] }],
    ['missing Property access', { accessible: [] }],
  ] as const)('fails closed for %s', async (_case, overrides) => {
    const { authority } = setup(overrides)

    await expect(authority.resolve(resolve('creator-1'))).resolves.toBeNull()
  })

  it('does not authorize an unrelated PropertyManager with current Property access', async () => {
    const { authority } = setup({
      managers: [
        {
          userId: 'unrelated-manager',
          role: 'PropertyManager',
          propertyAccessScope: 'assigned-properties',
        },
      ],
    })

    await expect(authority.resolve(resolve('unrelated-manager'))).resolves.toBeNull()
  })

  it('does not trust an organization-scoped display value as AccountAdmin authority', async () => {
    const { authority, staff } = setup({
      managers: [
        {
          userId: 'stale-admin',
          role: 'AccountAdmin',
          propertyAccessScope: 'organization',
        },
      ],
      accountAdmin: false,
    })

    await expect(authority.resolve(resolve('stale-admin'))).resolves.toBeNull()
    expect(staff.getAccessiblePropertyIds).not.toHaveBeenCalled()
  })
})
