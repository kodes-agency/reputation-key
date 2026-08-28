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
  categories: [{ id: 'category-1', title: 'More', sortKey: 'secret-sort-category' }],
  links: [
    {
      id: 'link-1',
      label: 'Visit us',
      url: 'https://secondary-destination.example/private-path',
      categoryId: 'category-1',
      sortKey: 'secret-sort-link',
    },
  ],
  reviewGateway: {
    privateFeedbackThreshold: 3,
    googleReview: {
      status: 'available',
      uri: 'https://search.google.com/local/writereview?placeid=portal-1',
    },
  },
  localization: {
    selectedLocale: 'en',
    primaryLocale: 'en',
    availableLocales: ['en'],
    languagePackVersion: 'guest-ui-en-v1',
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
    expect(projected).not.toHaveProperty('responseConfiguration')
    expect(JSON.stringify(projected)).not.toContain('secret-id')
    expect(projected.portal).not.toHaveProperty('id')
    expect(projected.reviewGateway.privateFeedbackThreshold).toBe(3)
    expect(projected.portal).not.toHaveProperty('slug')
    expect(projected.categories).toEqual([{ id: 'category-1', title: 'More' }])
    expect(projected.links).toEqual([
      { id: 'link-1', label: 'Visit us', categoryId: 'category-1' },
    ])
    expect(projected.reviewGateway.googleReview).toEqual({ status: 'available' })
    expect(JSON.stringify(projected)).not.toContain('secondary-destination.example')
    expect(JSON.stringify(projected)).not.toContain('search.google.com')
    expect(JSON.stringify(projected)).not.toContain('secret-sort')
  })

  it('cannot serialize a last-known Google URI in degraded state', () => {
    const projected = toPublicPortalLoaderData(
      {
        ...portal,
        reviewGateway: {
          privateFeedbackThreshold: 3,
          googleReview: { status: 'unavailable' },
        },
      },
      {
        guestSession: { csrfNonce: crypto.randomUUID() },
        response: null,
        responseForm: { availability: 'available' },
      },
    )

    expect(projected.reviewGateway.googleReview).toEqual({ status: 'unavailable' })
    expect(JSON.stringify(projected)).not.toContain('writereview')
  })
})
