import { describe, expect, it } from 'vitest'
import { createPublicPortalLookup } from './public-portal-lookup'
import type { PortalPublicApi } from '#/contexts/portal/application/public-api'

function createPortalApiStub(
  findPublicPortalByToken: PortalPublicApi['findPublicPortalByToken'],
): PortalPublicApi {
  return {
    resolvePortalContext: async () => null,
    getPortalInfo: async () => null,
    listCurrentPortalIds: async () => [],
    getResponsibleManagerUserIds: async () => [],
    findPortalHealthNotificationFacts: async () => null,
    findPublicPortalByToken,
    resolvePublishedAccessArtifact: async () => null,
  }
}

describe('createPublicPortalLookup', () => {
  it('collapses unavailable tokens to null', async () => {
    const lookup = createPublicPortalLookup(
      createPortalApiStub(async () => ({ status: 'unavailable' })),
    )

    await expect(lookup.findByToken('unknown')).resolves.toBeNull()
  })

  it('returns portal data for a resolved token', async () => {
    const result = {
      portal: {
        id: 'p1',
        name: 'Portal',
        slug: 'portal',
        description: null,
        heroImageUrl: null,
        theme: null,
        organizationName: 'Org',
      },
      categories: [],
      links: [],
      reviewGateway: {
        privateFeedbackThreshold: 3,
        googleReview: {
          status: 'available' as const,
          uri: 'https://search.google.com/local/writereview?placeid=p1',
        },
      },
      localization: {
        selectedLocale: 'en' as const,
        primaryLocale: 'en' as const,
        availableLocales: ['en'] as const,
        languagePackVersion: 'guest-ui-en-v1' as const,
      },
      responseConfiguration: {
        publicationState: 'published' as const,
        publicationSnapshotId: 'snapshot-1',
        publicationVersion: 1,
        publicationDigest: 'b'.repeat(64),
        configurationDigest: 'a'.repeat(64),
        guestLocale: 'en',
        languagePackVersion: 'guest-ui-en-v1',
        privateFeedbackThreshold: 3,
      },
      organizationId: 'org-1',
      propertyId: 'property-1',
    }
    const lookup = createPublicPortalLookup(
      createPortalApiStub(async () => ({ status: 'found', result })),
    )

    await expect(lookup.findByToken('pt_key_secret')).resolves.toBe(result)
  })

  it('rethrows infrastructure errors unchanged', async () => {
    const lookup = createPublicPortalLookup(
      createPortalApiStub(async () => {
        throw new Error('boom')
      }),
    )

    await expect(lookup.findByToken('pt_key_secret')).rejects.toThrow('boom')
  })
})
