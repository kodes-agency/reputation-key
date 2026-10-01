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
  guestSurface: 'legacy',
  immersive: null,
}

const immersivePortal: PublicPortalData = {
  ...portal,
  guestSurface: 'immersive',
  localization: {
    selectedLocale: 'bg',
    primaryLocale: 'en',
    availableLocales: ['en', 'bg'],
    languagePackVersion: 'guest-ui-bg-v2',
  },
  immersive: {
    timeZone: 'Europe/Sofia',
    brand: {
      displayName: 'Harbor',
      wordmark: 'HARBOR',
      logo: { url: '/media/logo.webp', width: 480, height: 120 },
      hero: {
        url: '/media/hero.webp',
        width: 1600,
        height: 1000,
        focalX: 0.4,
        focalY: 0.6,
      },
      accentColour: '#C8A45A',
      fieldColour: '#14110F',
    },
    content: {
      title: { value: 'Разкажете ни', fallbackFrom: null },
      shortDescription: { value: 'Вашето мнение.', fallbackFrom: null },
      heroAlt: { value: 'Harbor at dusk', fallbackFrom: 'en' },
      linktreeTitle: { value: 'Връзки', fallbackFrom: null },
    },
    linktree: { enabled: true },
    links: [
      {
        id: 'link-1',
        iconKey: 'utensils',
        imageUrl: null,
        label: 'Меню',
        line: null,
        fallbackFrom: null,
      },
    ],
  },
}
const SERVED_AT = '2026-10-01T12:00:00.000Z'
const state = () => ({
  guestSession: { csrfNonce: crypto.randomUUID() },
  servedAt: SERVED_AT,
  response: null,
  responseForm: { availability: 'available' as const },
})

describe('public Portal loader projection', () => {
  it('does not serialize internal tenant identifiers to the guest page', () => {
    const projected = toPublicPortalLoaderData(portal, {
      guestSession: { csrfNonce: crypto.randomUUID() },
      servedAt: SERVED_AT,
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

  it('carries the instant the server read the page, for deadlines both sides print alike', () => {
    expect(toPublicPortalLoaderData(portal, state()).servedAt).toBe(SERVED_AT)
  })

  it('declares the app fonts for a portal on the legacy guest surface', () => {
    const projected = toPublicPortalLoaderData(portal, {
      guestSession: { csrfNonce: crypto.randomUUID() },
      servedAt: SERVED_AT,
      response: null,
      responseForm: { availability: 'available' },
    })

    expect(projected.fontSet).toBe('app')
  })

  it('declares the guest fonts for a portal on the Immersive Hub surface', () => {
    const projected = toPublicPortalLoaderData(
      { ...portal, guestSurface: 'immersive' },
      {
        guestSession: { csrfNonce: crypto.randomUUID() },
        servedAt: SERVED_AT,
        response: null,
        responseForm: { availability: 'available' },
      },
    )

    expect(projected.fontSet).toBe('guest')
    expect(projected).not.toHaveProperty('guestSurface')
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
        servedAt: SERVED_AT,
        response: null,
        responseForm: { availability: 'available' },
      },
    )

    expect(projected.reviewGateway.googleReview).toEqual({ status: 'unavailable' })
    expect(JSON.stringify(projected)).not.toContain('writereview')
  })

  it('serves no Immersive Hub content for a legacy portal', () => {
    expect(toPublicPortalLoaderData(portal, state()).immersive).toBeNull()
  })

  it('projects the Immersive Hub content for the browser, field by field', () => {
    const projected = toPublicPortalLoaderData(immersivePortal, state())

    expect(projected.immersive).toEqual(immersivePortal.immersive)
    expect(projected.localization.selectedLocale).toBe('bg')
  })

  it('drops anything the server result carries beyond the reviewed fields', () => {
    const { immersive } = immersivePortal
    if (!immersive) throw new Error('fixture must be immersive')
    const leaky = {
      ...immersivePortal,
      immersive: {
        ...immersive,
        provenance: { aiDraftTextKeys: ['title:bg'] },
        brand: {
          ...immersive.brand,
          logoAssetId: 'asset-secret-1',
          objectKey: 'k/secret',
        },
        content: { ...immersive.content, digest: 'digest-secret' },
        links: immersive.links.map((link) => ({
          ...link,
          url: 'https://secondary-destination.example/private-path',
          imageAssetId: 'asset-secret-2',
        })),
      },
    } as PublicPortalData

    const serialized = JSON.stringify(toPublicPortalLoaderData(leaky, state()))

    for (const secret of [
      'aiDraftTextKeys',
      'provenance',
      'asset-secret',
      'k/secret',
      'digest-secret',
      'secondary-destination.example',
      'org-secret-id',
      'property-secret-id',
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })
})
