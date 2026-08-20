import { beforeEach, describe, expect, it, vi } from 'vitest'
import { portalError } from '../domain/errors'
import { organizationId, userId } from '#/shared/domain/ids'

const mocks = vi.hoisted(() => ({
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))

import {
  requireMatchingPortalResourceScopes,
  requirePortalResourceScope,
} from './property-scope'

const ACTOR = {
  userId: userId('user-1'),
  organizationId: organizationId('org-a'),
  role: 'AccountAdmin',
} as const

const operation = {
  actor: ACTOR,
  action: 'portal.update' as const,
  capability: 'portal.write' as const,
}

describe('Portal property execution scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireExecutionAllowed.mockImplementation(async ({ propertyId }) => {
      if (propertyId !== 'property-p1') throw new Error('policy_denied')
    })
  })

  it('authorizes a P1 opaque resource against its authoritative property', async () => {
    await expect(
      requirePortalResourceScope({
        ...operation,
        notFound: portalError('portal_not_found', 'portal not found'),
        lookup: async () => ({
          organizationId: 'org-a',
          propertyId: 'property-p1',
          portalId: 'portal-p1',
        }),
      }),
    ).resolves.toMatchObject({ propertyId: 'property-p1' })

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      ...operation,
      propertyId: 'property-p1',
    })
  })

  it('denies a P2 opaque resource before a caller can run its effect', async () => {
    let effects = 0

    await expect(
      requirePortalResourceScope({
        ...operation,
        notFound: portalError('portal_not_found', 'portal not found'),
        lookup: async () => ({
          organizationId: 'org-a',
          propertyId: 'property-p2',
          portalId: 'portal-p2',
        }),
      }).then(() => {
        effects += 1
      }),
    ).rejects.toThrow('policy_denied')

    expect(effects).toBe(0)
  })

  it('treats a wrong-organization opaque identifier as not found without policy evaluation', async () => {
    const notFound = portalError('portal_not_found', 'portal not found')

    await expect(
      requirePortalResourceScope({
        ...operation,
        notFound,
        lookup: async () => ({
          organizationId: 'org-b',
          propertyId: 'property-p1',
          portalId: 'portal-p1',
        }),
      }),
    ).rejects.toBe(notFound)

    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
  })

  it('rejects a forged P1 portal plus P2 category before policy or effects', async () => {
    const notFound = portalError('category_not_found', 'category not found')

    await expect(
      requireMatchingPortalResourceScopes({
        ...operation,
        notFound,
        lookups: [
          async () => ({
            organizationId: 'org-a',
            propertyId: 'property-p1',
            portalId: 'portal-p1',
          }),
          async () => ({
            organizationId: 'org-a',
            propertyId: 'property-p2',
            portalId: 'portal-p2',
          }),
        ],
      }),
    ).rejects.toBe(notFound)

    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
  })

  it('rejects a forged P1 group plus P2 Portal before membership effects', async () => {
    let effects = 0
    const notFound = portalError('portal_not_in_group', 'portal and group do not match')

    await expect(
      requireMatchingPortalResourceScopes({
        ...operation,
        notFound,
        lookups: [
          async () => ({ organizationId: 'org-a', propertyId: 'property-p1' }),
          async () => ({
            organizationId: 'org-a',
            propertyId: 'property-p2',
            portalId: 'portal-p2',
          }),
        ],
      }).then(() => {
        effects += 1
      }),
    ).rejects.toBe(notFound)

    expect(effects).toBe(0)
    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
  })
})
