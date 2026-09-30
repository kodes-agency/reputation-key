// Golden publication-snapshot rows: what verifyPortalPublicationSnapshot must
// keep accepting, byte for byte, for as long as any guest response points at
// one of them.
//
// A snapshot is immutable evidence. Guest responses reference it through a
// RESTRICT foreign key, and the digest is recomputed over the zod-parsed
// configuration every time it is read. A change to a schema, a default, a
// canonical-JSON rule or a language-pack constant that alters how one of these
// rows parses, or which digest it produces, would turn a historical portal
// unavailable. Nothing here may be regenerated to make a test pass: if a
// fixture stops verifying, the change under test is the defect.
//
// Provenance of each row:
//
// - GOLDEN_V2_SEEDED_ROW is a real row. `scripts/seed-e2e-user.ts` ran against
//   a database freshly built by `pnpm db:reset`, and the row was read back with
//   psql. `configuration`, `localeSet`, `languagePackVersions` and
//   `localizedContent` keep the key order PostgreSQL jsonb returned (shortest
//   key first), not the order the builder emitted, which is the order guest
//   reads see.
// - GOLDEN_V1_ROW and GOLDEN_V2_BG_PRIMARY_ROW are hand-built. The seed only
//   publishes a v2 English-primary portal, and no seeded row exists for a
//   legacy v1 shape or a Bulgarian-primary v2. Their digests were computed by
//   the production `buildPortalPublicationSnapshot` (which calls the private
//   `digestConfiguration`), then written down as literals here. The builder
//   inputs below are kept so a test can prove that claim on every run.

const GOLDEN_AT = new Date('2026-08-01T12:00:00.000Z')

const GOLDEN_SCOPE = {
  organizationId: 'golden-org',
  propertyId: '80000000-0000-4000-8000-000000000001',
  portalId: '90000000-0000-4000-8000-000000000001',
} as const

const GOLDEN_GOOGLE_URI =
  'https://search.google.com/local/writereview?placeid=golden-place'

/** Columns every row carries the same way; contact evidence stays at its defaults. */
const CONTACT_DEFAULTS = {
  contactRequestEnabled: false,
  contactNoticeId: null,
  contactNoticeVersion: null,
  contactNoticeDigest: null,
  contactNoticeLocale: null,
  contactRequestPurpose: 'manager_follow_up',
  contactRetentionPolicyVersion: 'guest-contact-retention-30d-v1',
} as const

/** A legacy v1 row: single English locale, no localized content, no brand profile. */
export const GOLDEN_V1_ROW = {
  id: 'a0000000-0000-4000-8000-000000000001',
  ...GOLDEN_SCOPE,
  version: 1,
  configurationDigest: 'eb95dfeac1db03dfcb7949bbcfbea5cafa211b5a7ed6bb945916bb4949e50af6',
  configuration: {
    portal: {
      id: GOLDEN_SCOPE.portalId,
      name: 'Golden Portal',
      slug: 'golden-portal',
      description: 'A portal frozen for golden tests.',
      heroImageUrl: null,
      theme: { primaryColor: '#6366F1' },
      organizationName: 'Golden Org',
    },
    categories: [
      {
        id: 'b0000000-0000-4000-8000-000000000001',
        title: 'Share your experience',
        sortKey: 'a0',
      },
    ],
    links: [
      {
        id: 'c0000000-0000-4000-8000-000000000001',
        label: 'Visit example review destination',
        url: 'https://example.com/reviews',
        categoryId: 'b0000000-0000-4000-8000-000000000001',
        sortKey: 'a0',
      },
    ],
    reviewGateway: {
      privateFeedbackThreshold: 3,
      googleReview: { status: 'available', uri: GOLDEN_GOOGLE_URI },
    },
    googleReviewBinding: {
      retrievedAt: '2026-08-01T12:00:00.000Z',
      sourceEpoch: 0,
      profileVersion: 1,
    },
    schemaVersion: 1,
    guestLocale: 'en',
    languagePackVersion: 'guest-ui-en-v1',
  },
  guestLocale: 'en',
  languagePackVersion: 'guest-ui-en-v1',
  localeSet: ['en'],
  languagePackVersions: { en: 'guest-ui-en-v1' },
  localizedContent: {},
  brandProfileVersion: null,
  privateFeedbackThreshold: 3,
  ...CONTACT_DEFAULTS,
  destinationUri: GOLDEN_GOOGLE_URI,
  destinationRetrievedAt: GOLDEN_AT,
  destinationSourceEpoch: 0,
  destinationProfileVersion: 1,
  createdBy: 'golden-fixture',
  createdAt: GOLDEN_AT,
}

/** A real v2 row, English primary with Bulgarian additional, as the e2e seed publishes it. */
export const GOLDEN_V2_SEEDED_ROW = {
  id: '11111111-1111-4111-a111-111111111111',
  organizationId: 'e2e-org-a',
  propertyId: '11111111-1111-4111-8111-111111111111',
  portalId: '11111111-1111-4111-9111-111111111111',
  version: 1,
  configurationDigest: 'ff7414f56f50a6bf42dc3b10837ea04cff5409cb595eab999a9b8d1e641d59e4',
  configuration: {
    links: [
      {
        id: '11111111-1111-4111-8111-111111111119',
        url: 'https://example.com/reviews',
        label: 'Visit example review destination',
        sortKey: 'a0',
        categoryId: '11111111-1111-4111-b111-111111111111',
      },
    ],
    portal: {
      id: '11111111-1111-4111-9111-111111111111',
      name: 'E2E Guest Portal P1',
      slug: 'e2e-guest-portal-p1',
      theme: { primaryColor: '#6366F1' },
      description: 'Published Portal fixture for local beta acceptance.',
      heroImageUrl: null,
      organizationName: 'E2E Test Organization',
    },
    localeSet: ['en', 'bg'],
    categories: [
      {
        id: '11111111-1111-4111-b111-111111111111',
        title: 'Share your experience',
        sortKey: 'a0',
      },
    ],
    guestLocale: 'en',
    brandProfile: {
      logoUrl: null,
      version: 1,
      textColor: '#111827',
      displayName: 'E2E Test Organization',
      primaryColor: '#6366F1',
      backgroundColor: '#FFFFFF',
      defaultHeroImageUrl: null,
    },
    reviewGateway: {
      googleReview: {
        uri: 'https://search.google.com/local/writereview?placeid=e2e-seed-place',
        status: 'available',
      },
      privateFeedbackThreshold: 3,
    },
    schemaVersion: 2,
    localizedContent: {
      bg: {
        title: 'E2E Guest Portal P1 (BG)',
        heroImageUrl: null,
        shortDescription: 'Публикуван портал за локално бета приемане.',
      },
      en: {
        title: 'E2E Guest Portal P1',
        heroImageUrl: null,
        shortDescription: 'Published Portal fixture for local beta acceptance.',
      },
    },
    googleReviewBinding: {
      retrievedAt: '2026-08-01T12:00:00.000Z',
      sourceEpoch: 0,
      profileVersion: 1,
    },
    languagePackVersion: 'guest-ui-en-v1',
    languagePackVersions: { bg: 'guest-ui-bg-v1', en: 'guest-ui-en-v1' },
  },
  guestLocale: 'en',
  languagePackVersion: 'guest-ui-en-v1',
  localeSet: ['en', 'bg'],
  languagePackVersions: { bg: 'guest-ui-bg-v1', en: 'guest-ui-en-v1' },
  localizedContent: {
    bg: {
      title: 'E2E Guest Portal P1 (BG)',
      heroImageUrl: null,
      shortDescription: 'Публикуван портал за локално бета приемане.',
    },
    en: {
      title: 'E2E Guest Portal P1',
      heroImageUrl: null,
      shortDescription: 'Published Portal fixture for local beta acceptance.',
    },
  },
  brandProfileVersion: 1,
  privateFeedbackThreshold: 3,
  ...CONTACT_DEFAULTS,
  destinationUri: 'https://search.google.com/local/writereview?placeid=e2e-seed-place',
  destinationRetrievedAt: GOLDEN_AT,
  destinationSourceEpoch: 0,
  destinationProfileVersion: 1,
  createdBy: 'local-beta-seed',
  createdAt: GOLDEN_AT,
}

/** A hand-built v2 row, Bulgarian primary with English additional (the locale order is meaningful). */
export const GOLDEN_V2_BG_PRIMARY_ROW = {
  id: 'a0000000-0000-4000-8000-000000000002',
  ...GOLDEN_SCOPE,
  version: 2,
  configurationDigest: 'a2c23af9c0c433c101db3d977bb89cecf735086068af66dbf89579782a32a1e8',
  configuration: {
    portal: {
      id: GOLDEN_SCOPE.portalId,
      name: 'Golden Portal',
      slug: 'golden-portal',
      description: 'A portal frozen for golden tests.',
      heroImageUrl: null,
      theme: { primaryColor: '#6366F1' },
      organizationName: 'Golden Org',
    },
    categories: [
      {
        id: 'b0000000-0000-4000-8000-000000000001',
        title: 'Share your experience',
        sortKey: 'a0',
      },
    ],
    links: [
      {
        id: 'c0000000-0000-4000-8000-000000000001',
        label: 'Visit example review destination',
        url: 'https://example.com/reviews',
        categoryId: 'b0000000-0000-4000-8000-000000000001',
        sortKey: 'a0',
      },
    ],
    reviewGateway: {
      privateFeedbackThreshold: 3,
      googleReview: { status: 'available', uri: GOLDEN_GOOGLE_URI },
    },
    googleReviewBinding: {
      retrievedAt: '2026-08-01T12:00:00.000Z',
      sourceEpoch: 0,
      profileVersion: 1,
    },
    schemaVersion: 2,
    guestLocale: 'bg',
    languagePackVersion: 'guest-ui-bg-v1',
    localeSet: ['bg', 'en'],
    languagePackVersions: { bg: 'guest-ui-bg-v1', en: 'guest-ui-en-v1' },
    localizedContent: {
      bg: {
        title: 'Златен портал',
        shortDescription: 'Портал, замразен за златни тестове.',
        heroImageUrl: null,
      },
      en: {
        title: 'Golden Portal',
        shortDescription: 'A portal frozen for golden tests.',
        heroImageUrl: null,
      },
    },
    brandProfile: {
      displayName: 'Golden Org',
      version: 1,
      primaryColor: '#6366F1',
      backgroundColor: '#FFFFFF',
      textColor: '#111827',
      logoUrl: null,
      defaultHeroImageUrl: null,
    },
  },
  guestLocale: 'bg',
  languagePackVersion: 'guest-ui-bg-v1',
  localeSet: ['bg', 'en'],
  languagePackVersions: { bg: 'guest-ui-bg-v1', en: 'guest-ui-en-v1' },
  localizedContent: {
    bg: {
      title: 'Златен портал',
      shortDescription: 'Портал, замразен за златни тестове.',
      heroImageUrl: null,
    },
    en: {
      title: 'Golden Portal',
      shortDescription: 'A portal frozen for golden tests.',
      heroImageUrl: null,
    },
  },
  brandProfileVersion: 1,
  privateFeedbackThreshold: 3,
  ...CONTACT_DEFAULTS,
  destinationUri: GOLDEN_GOOGLE_URI,
  destinationRetrievedAt: GOLDEN_AT,
  destinationSourceEpoch: 0,
  destinationProfileVersion: 1,
  createdBy: 'golden-fixture',
  createdAt: GOLDEN_AT,
}

export const GOLDEN_SNAPSHOT_ROWS = {
  v1: GOLDEN_V1_ROW,
  v2Seeded: GOLDEN_V2_SEEDED_ROW,
  v2BgPrimary: GOLDEN_V2_BG_PRIMARY_ROW,
} as const

const GOLDEN_PORTAL_SOURCE = {
  portal: GOLDEN_V1_ROW.configuration.portal,
  categories: GOLDEN_V1_ROW.configuration.categories,
  links: GOLDEN_V1_ROW.configuration.links,
  privateFeedbackThreshold: 3,
  organizationId: GOLDEN_SCOPE.organizationId,
  propertyId: GOLDEN_SCOPE.propertyId,
}

const GOLDEN_BUILD_COMMON = {
  ...GOLDEN_SCOPE,
  destination: {
    state: 'verified' as const,
    uri: GOLDEN_GOOGLE_URI,
    retrievedAt: GOLDEN_AT,
    sourceEpoch: 0,
    profileVersion: 1,
  },
  createdBy: 'golden-fixture',
  createdAt: GOLDEN_AT,
}

/**
 * The inputs the production builder needs to reproduce the two hand-built rows.
 * The tests rebuild both and compare digests, so the literals above cannot
 * drift away from `digestConfiguration` unnoticed.
 */
export const GOLDEN_BUILDER_INPUTS = {
  v1: {
    ...GOLDEN_BUILD_COMMON,
    id: GOLDEN_V1_ROW.id,
    version: 1,
    source: GOLDEN_PORTAL_SOURCE,
  },
  v2BgPrimary: {
    ...GOLDEN_BUILD_COMMON,
    id: GOLDEN_V2_BG_PRIMARY_ROW.id,
    version: 2,
    source: {
      ...GOLDEN_PORTAL_SOURCE,
      experience: {
        primaryGuestLocale: 'bg' as const,
        localeSet: ['bg', 'en'] as const,
        languagePackVersions: { en: 'guest-ui-en-v1', bg: 'guest-ui-bg-v1' },
        localizedContent: GOLDEN_V2_BG_PRIMARY_ROW.localizedContent,
        brandProfile: GOLDEN_V2_BG_PRIMARY_ROW.configuration.brandProfile,
      },
    },
  },
}
