import { describe, expect, it } from 'vitest'
import { toPublicPortalLoaderData, type PublicPortalData } from './public-portal.dto'

const portal: PublicPortalData = {
  portal: {
    id: 'portal-1',
    name: 'Lobby',
    slug: 'lobby',
    description: null,
    heroImageUrl: null,
    theme: null,
    organizationName: 'Hotel One',
  },
  categories: [],
  links: [],
  reviewGateway: {
    privateFeedbackThreshold: 3,
    googleReviewUri: 'https://search.google.com/local/writereview?placeid=portal-1',
  },
  organizationId: 'org-secret-id',
  propertyId: 'property-secret-id',
}

describe('public Portal loader projection', () => {
  it('does not serialize internal tenant identifiers to the guest page', () => {
    const projected = toPublicPortalLoaderData(portal, {
      guestSession: { csrfNonce: crypto.randomUUID() },
      response: null,
      responseForm: { availability: 'available' },
    })

    expect(projected).not.toHaveProperty('organizationId')
    expect(projected).not.toHaveProperty('propertyId')
    expect(JSON.stringify(projected)).not.toContain('secret-id')
    expect(projected.portal.id).toBe('portal-1')
    expect(projected.reviewGateway.privateFeedbackThreshold).toBe(3)
  })
})
