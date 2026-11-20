import { describe, expect, it } from 'vitest'
import { organizationId, userId } from '#/shared/domain/ids'
import { portalError } from '../domain/errors'
import {
  requireMatchingPortalResourceScopes,
  requireResourcesInPortalScope,
} from './property-scope'

// The scope helpers' own rules. Which roles and Organizations are admitted is
// asserted through the server functions in the *-handler.integration tests.

describe('forged resource pairs', () => {
  const operation = {
    actor: {
      userId: userId('user-1'),
      organizationId: organizationId('org-a'),
      role: 'AccountAdmin',
    } as const,
    action: 'portal.update' as const,
    capability: 'portal.write' as const,
  }

  it('rejects a forged P1 portal plus P2 category', async () => {
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
  })
})

describe('resources named beside an admitted Portal scope', () => {
  const admitted = {
    organizationId: 'org-a',
    propertyId: 'property-p1',
    portalId: 'portal-p1',
  }
  const notFound = portalError('link_not_found', 'portal link resource not found')
  const inScope = async () => ({ ...admitted })

  it('accepts resources of the admitted Portal', async () => {
    await expect(
      requireResourcesInPortalScope({
        scope: admitted,
        notFound,
        lookups: [inScope, inScope],
      }),
    ).resolves.toBeUndefined()
  })

  it.each([
    ['names no row', null],
    ['sits in another Portal', { ...admitted, portalId: 'portal-p2' }],
    ['sits in another Property', { ...admitted, propertyId: 'property-p2' }],
    ['sits in another Organization', { ...admitted, organizationId: 'org-b' }],
  ])('answers not found for a resource that %s', async (_case, stray) => {
    await expect(
      requireResourcesInPortalScope({
        scope: admitted,
        notFound,
        lookups: [inScope, async () => stray, inScope],
      }),
    ).rejects.toBe(notFound)
  })
})
