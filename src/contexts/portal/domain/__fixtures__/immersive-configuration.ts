// Test-only builder for a schema version 3 (Immersive Hub) configuration.
//
// Nothing in production writes v3 yet (slice 19 does), so the reader is proven
// against configurations built here: a complete English-primary one with a
// Bulgarian second language whose link wording is partly copied from English.
// Pure, so domain tests may use it. Not imported by production code.

import type { ImmersivePortalPublicationConfiguration } from '../portal-publication-snapshot'

export const IMMERSIVE_FIXTURE_SCOPE = Object.freeze({
  organizationId: 'org-1',
  propertyId: '20000000-0000-4000-8000-000000000001',
  portalId: '10000000-0000-4000-8000-000000000001',
})

export const IMMERSIVE_FIXTURE_GOOGLE_URI =
  'https://search.google.com/local/writereview?placeid=immersive-place'
export const IMMERSIVE_FIXTURE_AT = new Date('2026-09-30T09:00:00.000Z')
export const IMMERSIVE_HERO_ASSET_ID = '70000000-0000-4000-8000-000000000001'
export const IMMERSIVE_LOGO_ASSET_ID = '70000000-0000-4000-8000-000000000002'
export const IMMERSIVE_TILE_ASSET_ID = '70000000-0000-4000-8000-000000000003'

const own = <T>(value: T) => ({ value, fallbackFrom: null }) as const

/** English primary with Bulgarian added; the second link's Bulgarian is copied from English. */
export function immersiveConfiguration(
  overrides: Partial<ImmersivePortalPublicationConfiguration> = {},
): ImmersivePortalPublicationConfiguration {
  return {
    schemaVersion: 3,
    portal: { id: IMMERSIVE_FIXTURE_SCOPE.portalId, slug: 'harbor' },
    guestLocale: 'en',
    languagePackVersion: 'guest-ui-en-v2',
    localeSet: ['en', 'bg'],
    languagePackVersions: { en: 'guest-ui-en-v2', bg: 'guest-ui-bg-v2' },
    localizedContent: {
      en: {
        title: own('Tell us about your visit'),
        shortDescription: own('Rate your visit to the Harbor Hotel.'),
        heroAlt: own('The Harbor Hotel at dusk'),
        linktreeTitle: own('Useful links'),
      },
      bg: {
        title: own('Разкажете ни за посещението си'),
        shortDescription: own('Оценете посещението си в хотел Харбър.'),
        heroAlt: { value: 'The Harbor Hotel at dusk', fallbackFrom: 'en' },
        linktreeTitle: own('Полезни връзки'),
      },
    },
    linktree: { enabled: true },
    links: [
      {
        id: '30000000-0000-4000-8000-000000000001',
        url: 'https://harbor.example.com/menu',
        iconKey: 'utensils',
        imageAssetId: null,
        texts: {
          en: { label: 'Menu', line: 'Breakfast until 11', fallbackFrom: null },
          bg: { label: 'Меню', line: 'Закуска до 11', fallbackFrom: null },
        },
      },
      {
        id: '30000000-0000-4000-8000-000000000002',
        url: 'https://harbor.example.com/spa',
        iconKey: null,
        imageAssetId: IMMERSIVE_TILE_ASSET_ID,
        texts: {
          en: { label: 'Spa', line: null, fallbackFrom: null },
          bg: { label: 'Spa', line: null, fallbackFrom: 'en' },
        },
      },
    ],
    brandProfile: {
      displayName: 'The Harbor Hotel',
      wordmark: 'HARBOR',
      logo: { assetId: IMMERSIVE_LOGO_ASSET_ID, width: 480, height: 120 },
      hero: {
        assetId: IMMERSIVE_HERO_ASSET_ID,
        width: 1600,
        height: 1000,
        focalX: 0.4,
        focalY: 0.6,
      },
      accentColour: '#C8A45A',
      fieldColour: '#14110F',
      lookVersion: 3,
    },
    timeZone: 'Europe/Sofia',
    reviewGateway: {
      privateFeedbackThreshold: 3,
      googleReview: { status: 'available', uri: IMMERSIVE_FIXTURE_GOOGLE_URI },
    },
    googleReviewBinding: {
      retrievedAt: IMMERSIVE_FIXTURE_AT.toISOString(),
      sourceEpoch: 2,
      profileVersion: 5,
    },
    ...overrides,
  }
}

/**
 * The same portal with Bulgarian as the primary language: the texts English
 * had to copy are now written in Bulgarian and copied into English instead.
 */
export function bulgarianPrimaryConfiguration(
  overrides: Partial<ImmersivePortalPublicationConfiguration> = {},
): ImmersivePortalPublicationConfiguration {
  const base = immersiveConfiguration()
  const bg = base.localizedContent.bg
  const en = base.localizedContent.en
  const [menu, spa] = base.links
  if (!bg || !en || !menu || !spa) throw new Error('the fixture is incomplete')
  return {
    ...base,
    guestLocale: 'bg',
    languagePackVersion: 'guest-ui-bg-v2',
    localeSet: ['bg', 'en'],
    localizedContent: {
      bg: { ...bg, heroAlt: own('Хотел Харбър в здрача') },
      en: { ...en, heroAlt: { value: 'Хотел Харбър в здрача', fallbackFrom: 'bg' } },
    },
    links: [
      menu,
      {
        ...spa,
        texts: {
          bg: { label: 'Спа', line: null, fallbackFrom: null },
          en: { label: 'Спа', line: null, fallbackFrom: 'bg' },
        },
      },
    ],
    ...overrides,
  }
}
