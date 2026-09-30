// A golden schema version 3 (Immersive Hub) publication-snapshot row: what
// verifyPortalPublicationSnapshot must keep accepting, byte for byte, once the
// v3 writer (slice 19) has published such rows and guest responses point at
// them through RESTRICT foreign keys.
//
// The row is hand-built: no writer exists yet, so none could have produced a
// real one. Its digest was computed by the production
// `digestPortalPublicationConfiguration` and written down as a literal; the
// golden test recomputes it on every run, so this literal cannot drift from
// the digest function unnoticed. Nothing here may be regenerated to make a
// test pass: if the row stops verifying, the change under test is the defect.
//
// Shape under test: Bulgarian primary with English additional (the locale
// order is meaningful), an English text copied into Bulgarian with its
// `fallbackFrom` tag, two links (one with an icon, one with a tile image and a
// fallback wording), a hero photo with a focal point, a wordmark and logo, and
// the optional provenance that never reaches a guest.

import {
  CONTACT_DEFAULTS,
  GOLDEN_AT,
  GOLDEN_GOOGLE_URI,
  GOLDEN_SCOPE,
} from './publication-snapshots.golden'

const GOLDEN_V3_CONFIGURATION = {
  schemaVersion: 3,
  portal: { id: GOLDEN_SCOPE.portalId, slug: 'golden-portal' },
  guestLocale: 'bg',
  languagePackVersion: 'guest-ui-bg-v2',
  localeSet: ['bg', 'en'],
  languagePackVersions: { bg: 'guest-ui-bg-v2', en: 'guest-ui-en-v2' },
  localizedContent: {
    bg: {
      title: { value: 'Златен портал', fallbackFrom: null },
      shortDescription: {
        value: 'Портал, замразен за златни тестове.',
        fallbackFrom: null,
      },
      heroAlt: { value: 'Фасадата на хотела вечер', fallbackFrom: null },
      linktreeTitle: { value: 'Полезни връзки', fallbackFrom: null },
    },
    en: {
      title: { value: 'Golden Portal', fallbackFrom: null },
      shortDescription: {
        value: 'A portal frozen for golden tests.',
        fallbackFrom: null,
      },
      heroAlt: { value: 'Фасадата на хотела вечер', fallbackFrom: 'bg' },
      linktreeTitle: { value: 'Useful links', fallbackFrom: null },
    },
  },
  linktree: { enabled: true },
  links: [
    {
      id: 'c0000000-0000-4000-8000-000000000001',
      url: 'https://example.com/reviews',
      iconKey: 'star',
      imageAssetId: null,
      texts: {
        bg: {
          label: 'Отзиви',
          line: 'Прочетете какво казват гостите',
          fallbackFrom: null,
        },
        en: { label: 'Reviews', line: 'Read what guests say', fallbackFrom: null },
      },
    },
    {
      id: 'c0000000-0000-4000-8000-000000000002',
      url: 'https://example.com/spa',
      iconKey: null,
      imageAssetId: 'e0000000-0000-4000-8000-000000000003',
      texts: {
        bg: { label: 'Spa', line: null, fallbackFrom: null },
        en: { label: 'Spa', line: null, fallbackFrom: 'bg' },
      },
    },
  ],
  brandProfile: {
    displayName: 'Golden Org',
    wordmark: 'GOLDEN',
    logo: { assetId: 'e0000000-0000-4000-8000-000000000002', width: 480, height: 120 },
    hero: {
      assetId: 'e0000000-0000-4000-8000-000000000001',
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
    googleReview: { status: 'available', uri: GOLDEN_GOOGLE_URI },
  },
  googleReviewBinding: {
    retrievedAt: '2026-08-01T12:00:00.000Z',
    sourceEpoch: 0,
    profileVersion: 1,
  },
  provenance: { aiDraftTextKeys: ['title:en'] },
} as const

/** A hand-built v3 row, Bulgarian primary with English additional. */
export const GOLDEN_V3_BG_PRIMARY_ROW = {
  id: 'a0000000-0000-4000-8000-000000000003',
  ...GOLDEN_SCOPE,
  version: 3,
  configurationDigest: 'c376382525316e63323b240b0d371badfd559e6026320b2a125860e2667e3294',
  configuration: GOLDEN_V3_CONFIGURATION,
  guestLocale: 'bg',
  languagePackVersion: 'guest-ui-bg-v2',
  localeSet: ['bg', 'en'],
  languagePackVersions: { bg: 'guest-ui-bg-v2', en: 'guest-ui-en-v2' },
  localizedContent: GOLDEN_V3_CONFIGURATION.localizedContent,
  brandProfileVersion: 3,
  privateFeedbackThreshold: 3,
  ...CONTACT_DEFAULTS,
  destinationUri: GOLDEN_GOOGLE_URI,
  destinationRetrievedAt: GOLDEN_AT,
  destinationSourceEpoch: 0,
  destinationProfileVersion: 1,
  createdBy: 'golden-fixture',
  createdAt: GOLDEN_AT,
}
