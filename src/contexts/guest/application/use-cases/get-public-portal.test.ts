import { describe, expect, it, vi } from 'vitest'
import { getPublicPortal } from './get-public-portal'
import { isGuestError } from '../../domain/errors'
import type { PublicPortalData } from '../dto/public-portal.dto'

const fakeData: PublicPortalData = {
  portal: {
    id: 'p1',
    name: 'Test Portal',
    slug: 'test-portal',
    description: null,
    heroImageUrl: null,
    theme: null,
    organizationName: 'Test Org',
  },
  categories: [],
  links: [],
  reviewGateway: {
    privateFeedbackThreshold: 3,
    googleReview: {
      status: 'available',
      uri: 'https://search.google.com/local/writereview?placeid=p1',
    },
  },
  responseConfiguration: {
    publicationState: 'published',
    publicationSnapshotId: 'snapshot-1',
    publicationVersion: 1,
    publicationDigest: 'b'.repeat(64),
    configurationDigest: 'a'.repeat(64),
    guestLocale: 'en',
    languagePackVersion: 'guest-ui-en-v1',
    privateFeedbackThreshold: 3,
  },
  organizationId: 'org-1',
  propertyId: 'prop-1',
}

describe('getPublicPortal', () => {
  it('resolves the opaque token through the lookup boundary', async () => {
    const findByToken = vi.fn(async () => fakeData)
    const useCase = getPublicPortal({ publicPortalLookup: { findByToken } })

    await expect(useCase({ token: 'pt_key_secret' })).resolves.toEqual(fakeData)
    expect(findByToken).toHaveBeenCalledWith('pt_key_secret')
  })

  it('maps every unavailable token to portal_not_found', async () => {
    const useCase = getPublicPortal({
      publicPortalLookup: { findByToken: async () => null },
    })

    await expect(useCase({ token: 'unknown' })).rejects.toSatisfy(
      (error: unknown) => isGuestError(error) && error.code === 'portal_not_found',
    )
  })
})
