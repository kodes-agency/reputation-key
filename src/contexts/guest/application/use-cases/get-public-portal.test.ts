// Guest context — getPublicPortal use case tests
import { describe, it, expect } from 'vitest'
import { getPublicPortal } from './get-public-portal'
import { isGuestError } from '../../domain/errors'
import type { PublicPortalLoaderData } from '../dto/public-portal.dto'

const fakeData: PublicPortalLoaderData = {
  portal: {
    id: 'p1',
    name: 'Test Portal',
    slug: 'test-portal',
    description: null,
    heroImageUrl: null,
    theme: null,
    smartRoutingEnabled: false,
    smartRoutingThreshold: 4,
    organizationName: 'Test Org',
  },
  categories: [],
  links: [],
  organizationId: 'org-1',
  propertyId: 'prop-1',
} as unknown as PublicPortalLoaderData

const setup = (returns: PublicPortalLoaderData | null = fakeData) => {
  const useCase = getPublicPortal({
    publicPortalLookup: {
      findBySlug: async () => returns,
    },
  })
  return { useCase }
}

describe('getPublicPortal (use case)', () => {
  it('returns portal data when found', async () => {
    const { useCase } = setup()
    const result = await useCase({
      propertySlug: 'test-property',
      portalSlug: 'test-portal',
    })
    expect(result).toEqual(fakeData)
  })

  it('throws portal_not_found when portal does not exist', async () => {
    const { useCase } = setup(null)
    try {
      await useCase({ propertySlug: 'bad', portalSlug: 'bad' })
      expect.fail('Expected error to be thrown')
    } catch (e) {
      expect(isGuestError(e)).toBe(true)
      if (isGuestError(e)) {
        expect(e.code).toBe('portal_not_found')
      }
    }
  })
})
