import { describe, expect, it } from 'vitest'
import {
  IMMERSIVE_HUB_SCHEMA_VERSION,
  type PortalPublicationSnapshot,
} from '../domain/portal-publication-snapshot'
import type { PortalPublicationSource } from '../domain/portal-publication-source'
import { publicationSource } from '../domain/__fixtures__/publication-source'
import {
  buildPortalPublicationSnapshot,
  verifyPortalPublicationSnapshot,
} from './portal-publication-snapshot'

const NOW = new Date('2026-10-01T10:00:00.000Z')

const destination = {
  state: 'verified',
  uri: 'https://search.google.com/local/writereview?placeid=example',
  retrievedAt: new Date('2026-09-30T09:00:00.000Z'),
  sourceEpoch: 4,
  profileVersion: 7,
} as const

function build(
  source: PortalPublicationSource = publicationSource(),
  overrides: Partial<Parameters<typeof buildPortalPublicationSnapshot>[0]> = {},
): PortalPublicationSnapshot {
  return buildPortalPublicationSnapshot({
    id: '30000000-0000-4000-8000-000000000001',
    portalId: source.portal.id,
    organizationId: source.organizationId,
    propertyId: source.propertyId,
    version: 1,
    source,
    destination,
    createdBy: 'manager-1',
    createdAt: NOW,
    ...overrides,
  })
}

describe('the schema version 3 writer', () => {
  it('writes schema version 3 and nothing else', () => {
    const snapshot = build()

    expect(snapshot.configuration.schemaVersion).toBe(IMMERSIVE_HUB_SCHEMA_VERSION)
    expect(verifyPortalPublicationSnapshot(snapshot)).toBe(true)
  })

  it('pins the gateway and the Google binding beside the resolved content', () => {
    const { configuration } = build()

    expect(configuration).toMatchObject({
      reviewGateway: {
        privateFeedbackThreshold: 3,
        googleReview: { status: 'available', uri: destination.uri },
      },
      googleReviewBinding: {
        retrievedAt: destination.retrievedAt.toISOString(),
        sourceEpoch: 4,
        profileVersion: 7,
      },
      guestLocale: 'en',
      languagePackVersion: 'guest-ui-en-v2',
      timeZone: 'Europe/Sofia',
    })
  })

  it('keeps the row columns the reader cross-checks in step with the configuration', () => {
    const snapshot = build()

    expect(snapshot.destinationUri).toBe(destination.uri)
    expect(snapshot.destinationSourceEpoch).toBe(4)
    expect(snapshot.destinationProfileVersion).toBe(7)
  })

  it('is deterministic, and a changed working copy changes the digest', () => {
    const first = build()

    expect(build().configurationDigest).toBe(first.configurationDigest)
    expect(
      build(publicationSource({ linktreeEnabled: false })).configurationDigest,
    ).not.toBe(first.configurationDigest)
  })

  it('publishes a Bulgarian-primary portal as Bulgarian, never as English', () => {
    const snapshot = build(
      publicationSource({ primaryGuestLocale: 'bg', localeSet: ['bg', 'en'] }),
    )

    expect(snapshot.configuration).toMatchObject({
      guestLocale: 'bg',
      languagePackVersion: 'guest-ui-bg-v2',
      localeSet: ['bg', 'en'],
    })
    expect(verifyPortalPublicationSnapshot(snapshot)).toBe(true)
  })

  it('publishes a property with no brand profile, with the default look', () => {
    const snapshot = build(publicationSource({ look: null }))

    expect(snapshot.configuration).toMatchObject({
      brandProfile: { accentColour: '#EAD6A8', lookVersion: 1, hero: null, logo: null },
    })
    expect(verifyPortalPublicationSnapshot(snapshot)).toBe(true)
  })

  it('fills a gap in another language and tags the copy', () => {
    const base = publicationSource()
    const snapshot = build(
      publicationSource({
        wording: {
          en: base.wording.en!,
          bg: { title: null, shortDescription: null, heroAlt: null, linktreeTitle: null },
        },
      }),
    )

    expect(snapshot.configuration).toMatchObject({
      localizedContent: {
        bg: { title: { value: 'Tell us about your visit', fallbackFrom: 'en' } },
      },
    })
    expect(verifyPortalPublicationSnapshot(snapshot)).toBe(true)
  })

  describe('what it refuses', () => {
    it('does not silently fall back to an earlier design when the primary wording is missing', () => {
      const base = publicationSource()

      expect(() =>
        build(
          publicationSource({
            wording: { en: { ...base.wording.en!, title: null }, bg: base.wording.bg! },
          }),
        ),
      ).toThrow(/title.*primary language \(English\)/u)
    })

    it('tells the manager what to fix in plain words, never a key or a locale code', () => {
      const base = publicationSource()
      const messageFor = (overrides: Parameters<typeof publicationSource>[0]) => {
        try {
          build(publicationSource(overrides))
        } catch (error) {
          return (error as Error).message
        }
        return null
      }

      expect(
        messageFor({
          wording: { en: { ...base.wording.en!, title: null }, bg: base.wording.bg! },
        }),
      ).toBe('Write the title in the primary language (English) before publishing')
      expect(
        messageFor({
          wording: {
            en: { ...base.wording.en!, shortDescription: null },
            bg: base.wording.bg!,
          },
        }),
      ).toBe(
        'Write the short description in the primary language (English) before publishing',
      )
      expect(
        messageFor({ links: [{ ...base.links[0]!, texts: {} }, ...base.links.slice(1)] }),
      ).toBe('Write the link wording in the primary language (English) before publishing')
    })

    it('publishes German beside English, copying the English text where German has none', () => {
      const snapshot = build(
        publicationSource({
          localeSet: ['en', 'de'],
          wording: { en: publicationSource().wording.en! },
        }),
      )

      expect(verifyPortalPublicationSnapshot(snapshot)).toBe(true)
      expect(snapshot.configuration).toMatchObject({
        localeSet: ['en', 'de'],
        languagePackVersions: { en: 'guest-ui-en-v2', de: 'guest-ui-de-v2' },
        localizedContent: {
          de: {
            title: { fallbackFrom: 'en' },
            // German has its own default Linktree title, not the English one.
            linktreeTitle: { value: 'Nützliche Links', fallbackFrom: null },
          },
        },
      })
    })

    it('refuses a Property with no usable time zone', () => {
      expect(() => build(publicationSource({ timeZone: null }))).toThrow(/time zone/u)
    })

    it('refuses content the reader would refuse, which no blocker names', () => {
      expect(() =>
        build(
          publicationSource({
            look: { ...publicationSource().look!, displayName: '  ' },
          }),
        ),
      ).toThrow(/incomplete or out of range/u)
    })

    it('refuses an input whose scope disagrees with its source', () => {
      expect(() => build(publicationSource(), { portalId: 'another-portal' })).toThrow(
        /scope/u,
      )
    })

    it.each([0, 6])('refuses a private-feedback threshold of %s', (threshold) => {
      expect(() =>
        build(publicationSource({ privateFeedbackThreshold: threshold })),
      ).toThrow(/threshold/u)
    })

    it('refuses a destination that is not verified and complete', () => {
      expect(() =>
        build(publicationSource(), {
          destination: { ...destination, profileVersion: 0 },
        }),
      ).toThrow(/Google destination/u)
    })
  })
})
