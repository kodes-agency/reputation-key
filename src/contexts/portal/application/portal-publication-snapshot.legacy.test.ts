import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { PortalPublicationSnapshot } from '../domain/portal-publication-snapshot'
import { buildLegacyPortalPublicationSnapshot as buildPortalPublicationSnapshot } from './__fixtures__/legacy-snapshot-builder'
import { verifyPortalPublicationSnapshot } from './portal-publication-snapshot'

const NOW = new Date('2026-08-26T10:00:00.000Z')

const source = {
  portal: {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Lobby review gateway',
    slug: 'lobby',
    description: 'Tell us how your visit went.',
    heroImageUrl: null,
    theme: { primaryColor: '#123456' },
    organizationName: 'Example Hotels',
  },
  categories: [{ id: 'category-1', title: 'More', sortKey: 'a0' }],
  links: [
    {
      id: 'link-1',
      label: 'Property website',
      url: 'https://hotel.example.org/',
      categoryId: 'category-1',
      sortKey: 'a0',
    },
  ],
  privateFeedbackThreshold: 3,
  organizationId: 'org-1',
  propertyId: '20000000-0000-4000-8000-000000000001',
} as const

const destination = {
  state: 'verified',
  uri: 'https://search.google.com/local/writereview?placeid=example',
  retrievedAt: new Date('2026-08-25T09:00:00.000Z'),
  sourceEpoch: 4,
  profileVersion: 7,
} as const

// Publishing writes version 3 only; these rows are what it wrote before, and
// they must keep verifying (principle 5). The v3 writer's tests are in
// portal-publication-snapshot.test.ts.
describe('Portal publication snapshot, schema versions 1 and 2', () => {
  it('pins the exact rating-first public configuration behind a stable digest', () => {
    const snapshot = buildPortalPublicationSnapshot({
      id: '30000000-0000-4000-8000-000000000001',
      portalId: source.portal.id,
      organizationId: source.organizationId,
      propertyId: source.propertyId,
      version: 1,
      source,
      destination,
      createdBy: 'manager-1',
      createdAt: NOW,
    })

    expect(snapshot.configuration).toEqual({
      schemaVersion: 1,
      guestLocale: 'en',
      languagePackVersion: 'guest-ui-en-v1',
      portal: source.portal,
      categories: source.categories,
      links: source.links,
      reviewGateway: {
        privateFeedbackThreshold: 3,
        googleReview: {
          status: 'available',
          uri: destination.uri,
        },
      },
      googleReviewBinding: {
        retrievedAt: destination.retrievedAt.toISOString(),
        sourceEpoch: 4,
        profileVersion: 7,
      },
    })
    expect(snapshot.configurationDigest).toBe(
      'b559d36b2e64b34dc66bf3df0abbab13a4d48792a43dfa182c7e0b9907b059d4',
    )
    expect(verifyPortalPublicationSnapshot(snapshot)).toBe(true)
  })

  it('does not let a changed working copy masquerade as the published version', () => {
    const first = buildPortalPublicationSnapshot({
      id: '30000000-0000-4000-8000-000000000001',
      portalId: source.portal.id,
      organizationId: source.organizationId,
      propertyId: source.propertyId,
      version: 1,
      source,
      destination,
      createdBy: 'manager-1',
      createdAt: NOW,
    })
    const changed = buildPortalPublicationSnapshot({
      id: '30000000-0000-4000-8000-000000000002',
      portalId: source.portal.id,
      organizationId: source.organizationId,
      propertyId: source.propertyId,
      version: 2,
      source: {
        ...source,
        portal: { ...source.portal, name: 'Changed working copy' },
      },
      destination,
      createdBy: 'manager-1',
      createdAt: new Date(NOW.getTime() + 1_000),
    })

    expect(changed.configurationDigest).not.toBe(first.configurationDigest)
    expect(first.configuration).toMatchObject({
      portal: { name: 'Lobby review gateway' },
    })
  })

  it('pins the complete accessible EN/BG brand experience in schema version 2', () => {
    const snapshot = buildPortalPublicationSnapshot({
      id: '30000000-0000-4000-8000-000000000010',
      portalId: source.portal.id,
      organizationId: source.organizationId,
      propertyId: source.propertyId,
      version: 3,
      source: {
        ...source,
        experience: {
          primaryGuestLocale: 'bg',
          localeSet: ['bg', 'en'],
          languagePackVersions: {
            en: 'guest-ui-en-v1',
            bg: 'guest-ui-bg-v1',
          },
          localizedContent: {
            en: {
              title: 'Tell us about your stay',
              shortDescription: 'Your view matters.',
              heroImageUrl: null,
            },
            bg: {
              title: 'Разкажете ни за престоя си',
              shortDescription: 'Вашето мнение е важно.',
              heroImageUrl: 'https://cdn.example.com/bg-hero.webp',
            },
          },
          brandProfile: {
            displayName: 'Хотел Пример',
            logoUrl: null,
            defaultHeroImageUrl: null,
            primaryColor: '#1D4ED8',
            backgroundColor: '#FFFFFF',
            textColor: '#111827',
            version: 7,
          },
        },
      },
      destination,
      createdBy: 'manager-1',
      createdAt: NOW,
    })

    expect(snapshot.configuration).toMatchObject({
      schemaVersion: 2,
      guestLocale: 'bg',
      languagePackVersion: 'guest-ui-bg-v1',
      localeSet: ['bg', 'en'],
      brandProfile: { displayName: 'Хотел Пример', version: 7 },
      localizedContent: {
        bg: { title: 'Разкажете ни за престоя си' },
        en: { title: 'Tell us about your stay' },
      },
    })
    expect(verifyPortalPublicationSnapshot(snapshot)).toBe(true)
  })

  it('fails verification when stored content no longer matches its digest', () => {
    const snapshot = buildPortalPublicationSnapshot({
      id: '30000000-0000-4000-8000-000000000001',
      portalId: source.portal.id,
      organizationId: source.organizationId,
      propertyId: source.propertyId,
      version: 1,
      source,
      destination,
      createdBy: 'manager-1',
      createdAt: NOW,
    })

    expect(
      verifyPortalPublicationSnapshot({
        ...snapshot,
        configuration: {
          ...snapshot.configuration,
          portal: { ...snapshot.configuration.portal, name: 'Tampered' },
        } as PortalPublicationSnapshot['configuration'],
      }),
    ).toBe(false)
  })

  describe('language pack and schema version binding', () => {
    const localized = buildPortalPublicationSnapshot({
      id: '30000000-0000-4000-8000-000000000020',
      portalId: source.portal.id,
      organizationId: source.organizationId,
      propertyId: source.propertyId,
      version: 2,
      source: {
        ...source,
        experience: {
          primaryGuestLocale: 'en',
          localeSet: ['en', 'bg'],
          languagePackVersions: { en: 'guest-ui-en-v1', bg: 'guest-ui-bg-v1' },
          localizedContent: {
            en: { title: 'Tell us', shortDescription: 'Your view.', heroImageUrl: null },
            bg: { title: 'Кажете ни', shortDescription: 'Мнението.', heroImageUrl: null },
          },
          brandProfile: {
            displayName: 'Example Hotel',
            logoUrl: null,
            defaultHeroImageUrl: null,
            primaryColor: '#1D4ED8',
            backgroundColor: '#FFFFFF',
            textColor: '#111827',
            version: 1,
          },
        },
      },
      destination,
      createdBy: 'manager-1',
      createdAt: NOW,
    })

    /** Rewrites the configuration and re-digests it, so only the content check can object. */
    function withConfiguration(
      overrides: Record<string, unknown>,
    ): PortalPublicationSnapshot {
      const configuration = { ...localized.configuration, ...overrides }
      return {
        ...localized,
        configuration: configuration as PortalPublicationSnapshot['configuration'],
        configurationDigest: createHash('sha256')
          .update(canonicalizeRfc8785(configuration), 'utf8')
          .digest('hex'),
      }
    }

    it('accepts the untouched localized snapshot', () => {
      expect(verifyPortalPublicationSnapshot(localized)).toBe(true)
      expect(verifyPortalPublicationSnapshot(withConfiguration({}))).toBe(true)
    })

    it('rejects the Bulgarian pack recorded for English', () => {
      expect(
        verifyPortalPublicationSnapshot(
          withConfiguration({
            languagePackVersions: { en: 'guest-ui-bg-v1', bg: 'guest-ui-bg-v1' },
          }),
        ),
      ).toBe(false)
    })

    it('rejects a generation 2 pack in a v2 snapshot, and a missing pack', () => {
      // guest-ui-en-v2 is a real pack, but only schema version 3 may carry it.
      expect(
        verifyPortalPublicationSnapshot(
          withConfiguration({
            languagePackVersions: { en: 'guest-ui-en-v2', bg: 'guest-ui-bg-v1' },
          }),
        ),
      ).toBe(false)
      expect(
        verifyPortalPublicationSnapshot(
          withConfiguration({ languagePackVersions: { en: 'guest-ui-en-v1' } }),
        ),
      ).toBe(false)
    })

    it('fails closed on a schema version this build does not know', () => {
      for (const schemaVersion of [0, 4, 99]) {
        expect(
          verifyPortalPublicationSnapshot(withConfiguration({ schemaVersion })),
        ).toBe(false)
      }
    })

    it('rejects a v2 configuration relabelled v3: its shape and packs are not v3', () => {
      expect(
        verifyPortalPublicationSnapshot(withConfiguration({ schemaVersion: 3 })),
      ).toBe(false)
    })

    it('rejects a v1 configuration that carries any pack but the English v1 pack', () => {
      const v1 = buildPortalPublicationSnapshot({
        id: '30000000-0000-4000-8000-000000000021',
        portalId: source.portal.id,
        organizationId: source.organizationId,
        propertyId: source.propertyId,
        version: 1,
        source,
        destination,
        createdBy: 'manager-1',
        createdAt: NOW,
      })
      const bgPack = { ...v1.configuration, languagePackVersion: 'guest-ui-bg-v1' }
      expect(
        verifyPortalPublicationSnapshot({
          ...v1,
          configuration: bgPack as PortalPublicationSnapshot['configuration'],
          configurationDigest: createHash('sha256')
            .update(canonicalizeRfc8785(bgPack), 'utf8')
            .digest('hex'),
        }),
      ).toBe(false)
    })
  })
})
