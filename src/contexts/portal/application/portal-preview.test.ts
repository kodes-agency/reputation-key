import { describe, expect, it } from 'vitest'
import { buildPortalLinktreeView } from '../domain/portal-linktree-view'
import {
  buildTestPortal,
  buildTestPortalLink,
  buildTestPortalLinkCategory,
} from '#/shared/testing/fixtures'
import { portalApprovedDestinationId, userId } from '#/shared/domain/ids'
import type { PortalApprovedDestination } from '../domain/approved-destination'
import type { ResolvedPortalLinkText } from '../domain/portal-linktree'
import {
  IMMERSIVE_HERO_ASSET_ID,
  IMMERSIVE_LOGO_ASSET_ID,
  immersiveConfiguration,
  immersiveSnapshot,
} from './__fixtures__/immersive-snapshot'
import { buildDraftPortalPreview, buildLivePortalPreview } from './portal-preview'
import { NO_PROPERTY_LOOK_MEDIA } from './property-look-media'
import type { PortalPreview } from './portal-preview'

const AT = new Date('2026-10-01T12:00:00Z')
const APPROVED_URL = 'https://avela.bg/olive-terrace/menu'
const PENDING_URL = 'https://pending.example.test/not-yet'

const destination = (
  id: string,
  uri: string,
  approvalState: PortalApprovedDestination['approvalState'],
): PortalApprovedDestination => ({
  id: portalApprovedDestinationId(id),
  organizationId: buildTestPortal().organizationId,
  propertyId: buildTestPortal().propertyId,
  normalizedUri: uri,
  hostname: new URL(uri).hostname,
  sourceType: 'custom',
  approvalState,
  validationVersion: 'portal-destination-https-v1',
  requestedBy: userId('user-1'),
  approvedBy: approvalState === 'approved' ? userId('admin-1') : null,
  approvedAt: approvalState === 'approved' ? AT : null,
  disabledAt: null,
  disabledReason: null,
  lastValidatedAt: AT,
  createdAt: AT,
  updatedAt: AT,
})

const text = (
  linkId: string,
  locale: ResolvedPortalLinkText['locale'],
  label: string,
  line: string | null = null,
): ResolvedPortalLinkText => ({
  linkId,
  locale,
  label,
  line,
  provenance: null,
  version: 1,
  updatedBy: 'user-1',
  updatedAt: AT,
  source: 'text',
})

const APPROVED_ID = '20000000-0000-0000-0000-000000000001'
const PENDING_ID = '20000000-0000-0000-0000-000000000002'
const MENU_LINK = '10000000-0000-0000-0000-0000000000a1'
const SPA_LINK = '10000000-0000-0000-0000-0000000000a2'

const PROFILE = {
  displayName: 'Avela Resort',
  wordmark: 'AVELA',
  logoUrl: null,
  defaultHeroImageUrl: 'https://photos.example.test/avela.jpg',
  primaryColor: '#C8A45A',
  backgroundColor: '#14110F',
  backgroundMode: 'auto' as const,
  lookVersion: 4,
}

type DraftOptions = Partial<Parameters<typeof buildDraftPortalPreview>[0]>

function draft(options: DraftOptions = {}): PortalPreview {
  const portal = buildTestPortal({
    name: 'Pool & Terrace',
    description: null,
    additionalGuestLocales: ['bg'],
    privateFeedbackThreshold: 3,
  })
  const category = buildTestPortalLinkCategory({})
  const menu = buildTestPortalLink({
    id: MENU_LINK as never,
    categoryId: category.id,
    destinationId: portalApprovedDestinationId(APPROVED_ID),
    url: APPROVED_URL,
    label: 'Menu',
    iconKey: 'utensils',
    sortKey: 'a0',
  })
  const spa = buildTestPortalLink({
    id: SPA_LINK as never,
    categoryId: category.id,
    destinationId: portalApprovedDestinationId(PENDING_ID),
    url: PENDING_URL,
    label: 'Spa',
    sortKey: 'a1',
  })
  const linktree = buildPortalLinktreeView({
    servableImageIds: new Set<string>(),
    portal,
    categories: [category],
    links: [menu, spa],
    texts: [
      text(MENU_LINK, 'en', 'Olive Terrace menu', 'Lunch and dinner'),
      text(MENU_LINK, 'bg', 'Меню на Олив Тераса'),
      text(SPA_LINK, 'en', 'Spa & treatments', 'Book a time'),
    ],
    titles: [{ locale: 'en', linktreeTitle: 'Around the resort' }],
    destinations: [
      destination(APPROVED_ID, APPROVED_URL, 'approved'),
      destination(PENDING_ID, PENDING_URL, 'pending'),
    ],
  })
  return buildDraftPortalPreview({
    portal,
    linktree,
    profile: PROFILE,
    media: NO_PROPERTY_LOOK_MEDIA,
    content: [
      {
        locale: 'en',
        title: 'Avela Resort',
        shortDescription: 'Rate your visit.',
        heroAltText: 'Colonnade pool',
      },
      {
        locale: 'bg',
        title: 'Курорт Авела',
        shortDescription: 'Оценете посещението.',
        heroAltText: null,
      },
    ],
    overrides: [],
    timeZone: 'Europe/Sofia',
    ...options,
  })
}

const experienceOf = (preview: PortalPreview, locale: 'en' | 'bg' | 'de') => {
  const experience = preview.experiences[locale]
  if (!experience) throw new Error(`no ${locale} experience`)
  return experience
}

/** `null` is a link with no destination record: one from before approvals existed. */
function draftWithSpaDestination(
  approvalState: PortalApprovedDestination['approvalState'] | null,
): PortalPreview {
  const portal = buildTestPortal({ name: 'Pool', additionalGuestLocales: [] })
  const category = buildTestPortalLinkCategory({})
  const spa = buildTestPortalLink({
    id: SPA_LINK as never,
    categoryId: category.id,
    destinationId: portalApprovedDestinationId(PENDING_ID),
    url: PENDING_URL,
    label: 'Spa',
    sortKey: 'a1',
  })
  return buildDraftPortalPreview({
    portal,
    linktree: buildPortalLinktreeView({
      servableImageIds: new Set<string>(),
      portal,
      categories: [category],
      links: [spa],
      texts: [text(SPA_LINK, 'en', 'Spa & treatments')],
      titles: [],
      destinations:
        approvalState === null
          ? []
          : [destination(PENDING_ID, PENDING_URL, approvalState)],
    }),
    profile: PROFILE,
    media: NO_PROPERTY_LOOK_MEDIA,
    content: [],
    overrides: [],
    timeZone: 'Europe/Sofia',
  })
}

function draftWithTilePhoto(imageAssetId: string | null, isServable = true) {
  const portal = buildTestPortal({ name: 'Pool', additionalGuestLocales: [] })
  const category = buildTestPortalLinkCategory({})
  const menu = buildTestPortalLink({
    id: MENU_LINK as never,
    categoryId: category.id,
    destinationId: portalApprovedDestinationId(APPROVED_ID),
    url: APPROVED_URL,
    label: 'Menu',
    sortKey: 'a0',
    imageAssetId: imageAssetId as never,
  })
  return buildDraftPortalPreview({
    portal,
    linktree: buildPortalLinktreeView({
      servableImageIds: new Set(imageAssetId && isServable ? [imageAssetId] : []),
      portal,
      categories: [category],
      links: [menu],
      texts: [text(MENU_LINK, 'en', 'Menu')],
      titles: [],
      destinations: [destination(APPROVED_ID, APPROVED_URL, 'approved')],
    }),
    profile: PROFILE,
    media: NO_PROPERTY_LOOK_MEDIA,
    content: [],
    overrides: [],
    timeZone: 'Europe/Sofia',
  })
}

describe('buildDraftPortalPreview', () => {
  it('describes the working copy for every language the portal offers', () => {
    const preview = draft()

    expect(preview).toMatchObject({
      source: 'draft',
      primaryLocale: 'en',
      locales: ['en', 'bg'],
      privateFeedbackThreshold: 3,
      version: null,
    })
    expect(Object.keys(preview.experiences)).toEqual(['en', 'bg'])
    expect(experienceOf(preview, 'en')).toMatchObject({
      timeZone: 'Europe/Sofia',
      linktree: { enabled: true },
      content: {
        title: { value: 'Avela Resort', fallbackFrom: null },
        heroAlt: { value: 'Colonnade pool', fallbackFrom: null },
        linktreeTitle: { value: 'Around the resort', fallbackFrom: null },
      },
    })
  })

  it('draws the look from the Brand Profile: accent, derived field, wordmark', () => {
    const { brand } = experienceOf(draft(), 'en')

    expect(brand).toMatchObject({
      displayName: 'Avela Resort',
      wordmark: 'AVELA',
      accentColour: '#C8A45A',
    })
    expect(brand.fieldColour).toMatch(/^#[0-9A-F]{6}$/)
    expect(brand.fieldColour).not.toBe('#14110F')
  })

  it('draws the photograph and logo the Property uploaded, with their sizes and the focal point', () => {
    const { brand } = experienceOf(
      draft({
        media: {
          hero: {
            assetId: 'a1',
            url: '/api/public/portal-media/a1',
            width: 2400,
            height: 1600,
            focalX: 0.3,
            focalY: 0.6,
          },
          logo: {
            assetId: 'a2',
            url: '/api/public/portal-media/a2',
            width: 480,
            height: 120,
          },
        },
      }),
      'en',
    )

    expect(brand.hero).toEqual({
      url: '/api/public/portal-media/a1',
      width: 2400,
      height: 1600,
      focalX: 0.3,
      focalY: 0.6,
    })
    expect(brand.logo).toEqual({
      url: '/api/public/portal-media/a2',
      width: 480,
      height: 120,
    })
  })

  it('does not draw a photograph that is only an address, which a published page would drop', () => {
    const rowWithAddresses = {
      ...PROFILE,
      logoUrl: 'https://photos.example.test/logo.png',
      defaultHeroImageUrl: 'https://photos.example.test/avela.jpg',
    }
    const { brand } = experienceOf(
      draft({
        profile: rowWithAddresses,
        overrides: [
          {
            locale: 'en',
            title: null,
            shortDescription: null,
            heroImageUrl: 'https://photos.example.test/override.jpg',
          },
        ],
      }),
      'en',
    )

    expect(brand.hero).toBeNull()
    expect(brand.logo).toBeNull()
  })

  it('shows a tile its uploaded photo', () => {
    const preview = draftWithTilePhoto('70000000-0000-4000-8000-0000000000aa')

    expect(experienceOf(preview, 'en').links[0]?.imageUrl).toBe(
      '/api/public/portal-media/70000000-0000-4000-8000-0000000000aa',
    )
  })

  it('shows a tile with no photo, or whose photo was taken down, as having none', () => {
    expect(experienceOf(draftWithTilePhoto(null), 'en').links[0]?.imageUrl).toBeNull()
    expect(
      experienceOf(
        draftWithTilePhoto('70000000-0000-4000-8000-0000000000aa', false),
        'en',
      ).links[0]?.imageUrl,
    ).toBeNull()
  })

  it('uses the stored background as the field when the Property chose it by hand', () => {
    const preview = draft({ profile: { ...PROFILE, backgroundMode: 'manual' } })

    expect(experienceOf(preview, 'en').brand.fieldColour).toBe('#14110F')
  })

  it('starts from champagne on a dark field when the Property has no Brand Profile yet', () => {
    const preview = draft({ profile: null })
    const { brand } = experienceOf(preview, 'en')

    expect(brand).toMatchObject({
      displayName: 'Pool & Terrace',
      wordmark: null,
      hero: null,
      accentColour: '#EAD6A8',
    })
    expect(brand.fieldColour).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('prefers the Portal override over the Property wording', () => {
    const preview = draft({
      overrides: [
        { locale: 'en', title: 'Pool side', shortDescription: null, heroImageUrl: null },
      ],
    })

    expect(experienceOf(preview, 'en').content.title.value).toBe('Pool side')
    expect(experienceOf(preview, 'en').content.shortDescription.value).toBe(
      'Rate your visit.',
    )
  })

  it('copies the primary language into a gap and says where it came from', () => {
    const preview = draft({
      content: [
        {
          locale: 'en',
          title: 'Avela Resort',
          shortDescription: 'Rate your visit.',
          heroAltText: 'Colonnade pool',
        },
        {
          locale: 'bg',
          title: 'Курорт Авела',
          shortDescription: 'Оценете посещението.',
          heroAltText: null,
        },
      ],
    })

    expect(experienceOf(preview, 'bg').content).toMatchObject({
      title: { value: 'Курорт Авела', fallbackFrom: null },
      heroAlt: { value: 'Colonnade pool', fallbackFrom: 'en' },
    })
  })

  it('falls back to the primary wording for a language the Property has no wording for', () => {
    const preview = draft({
      portal: buildTestPortal({ name: 'Pool & Terrace', additionalGuestLocales: ['bg'] }),
      content: [
        {
          locale: 'en',
          title: 'Avela Resort',
          shortDescription: 'Rate your visit.',
          heroAltText: null,
        },
      ],
    })

    expect(experienceOf(preview, 'bg').content.title).toEqual({
      value: 'Avela Resort',
      fallbackFrom: 'en',
    })
  })

  it('does not count a Portal override on a language whose row holds only a photograph description', () => {
    const preview = draft({
      portal: buildTestPortal({ name: 'Pool & Terrace', additionalGuestLocales: ['bg'] }),
      content: [
        {
          locale: 'en',
          title: 'Avela Resort',
          shortDescription: 'Rate your visit.',
          heroAltText: null,
        },
        { locale: 'bg', title: '', shortDescription: '', heroAltText: 'Басейн' },
      ],
      overrides: [
        { locale: 'bg', title: 'Басейн', shortDescription: null, heroImageUrl: null },
      ],
    })

    expect(experienceOf(preview, 'bg').content.title).toEqual({
      value: 'Avela Resort',
      fallbackFrom: 'en',
    })
  })

  it('names the Portal when even the primary language has no wording', () => {
    const preview = draft({ content: [] })

    expect(experienceOf(preview, 'en').content.title).toEqual({
      value: 'Pool & Terrace',
      fallbackFrom: null,
    })
  })

  it("uses the pack's default title for a Linktree no one has titled", () => {
    const bg = experienceOf(draft(), 'bg')

    expect(bg.content.linktreeTitle).toEqual({
      value: 'Полезни връзки',
      fallbackFrom: null,
    })
  })

  it('does not copy the primary Linktree title into a language that has none: it reads that language default', () => {
    const portal = buildTestPortal({
      name: 'Pool',
      additionalGuestLocales: ['bg'],
    })
    const preview = draft({
      portal,
      linktree: buildPortalLinktreeView({
        servableImageIds: new Set<string>(),
        portal,
        categories: [],
        links: [],
        texts: [],
        titles: [{ locale: 'en', linktreeTitle: 'Around the resort' }],
        destinations: [],
      }),
    })

    expect(experienceOf(preview, 'en').content.linktreeTitle.value).toBe(
      'Around the resort',
    )
    expect(experienceOf(preview, 'bg').content.linktreeTitle).toEqual({
      value: 'Полезни връзки',
      fallbackFrom: null,
    })
  })

  it('lists the tiles in guest order with their words in each language', () => {
    const preview = draft()

    expect(experienceOf(preview, 'en').links).toMatchObject([
      {
        id: MENU_LINK,
        label: 'Olive Terrace menu',
        line: 'Lunch and dinner',
        iconKey: 'utensils',
        fallbackFrom: null,
      },
      {
        id: SPA_LINK,
        label: 'Spa & treatments',
        line: 'Book a time',
        fallbackFrom: null,
      },
    ])
    expect(experienceOf(preview, 'bg').links[0]).toMatchObject({
      label: 'Меню на Олив Тераса',
      fallbackFrom: null,
    })
  })

  it('shows the primary wording where a tile has no text in the language yet', () => {
    const spaInBulgarian = experienceOf(draft(), 'bg').links[1]

    expect(spaInBulgarian).toMatchObject({
      label: 'Spa & treatments',
      line: 'Book a time',
      fallbackFrom: 'en',
    })
  })

  it('draws a tile whose address is approved as ready', () => {
    expect(experienceOf(draft(), 'en').links[0]?.state).toBe('ready')
  })

  it('draws a tile whose address is not approved as a placeholder, never as a destination', () => {
    const [, waiting] = experienceOf(draft(), 'en').links

    expect(waiting?.state).toBe('awaiting_approval')
  })

  it.each([
    ['pending', 'awaiting_approval'],
    ['disabled', 'not_approved'],
    ['quarantined', 'not_approved'],
    [null, 'not_approved'],
  ] as const)(
    'draws an address that is %s as %s: only a pending one is waiting for an approval',
    (approvalState, expected) => {
      const preview = draftWithSpaDestination(approvalState)

      expect(experienceOf(preview, 'en').links[0]?.state).toBe(expected)
    },
  )

  it('never puts an address into the preview, approved or not', () => {
    const json = JSON.stringify(draft())

    expect(json).not.toContain(PENDING_URL)
    expect(json).not.toContain('pending.example.test')
    expect(json).not.toContain(APPROVED_URL)
  })

  it('keeps the tiles but turns the section off with the switch', () => {
    const portal = buildTestPortal({ name: 'Pool', linktreeEnabled: false })
    const preview = draft({
      portal,
      linktree: buildPortalLinktreeView({
        servableImageIds: new Set<string>(),
        portal,
        categories: [],
        links: [],
        texts: [],
        titles: [],
        destinations: [],
      }),
    })

    expect(experienceOf(preview, 'en').linktree.enabled).toBe(false)
  })

  it('serves one language when the portal has only one', () => {
    const portal = buildTestPortal({ name: 'Pool', additionalGuestLocales: [] })
    const preview = draft({
      portal,
      linktree: buildPortalLinktreeView({
        servableImageIds: new Set<string>(),
        portal,
        categories: [],
        links: [],
        texts: [],
        titles: [],
        destinations: [],
      }),
    })

    expect(preview.locales).toEqual(['en'])
  })
})

describe('buildLivePortalPreview', () => {
  const snapshot = immersiveSnapshot()
  const allApproved = new Set(
    snapshot.configuration.schemaVersion === 3
      ? ['https://harbor.example.com/menu', 'https://harbor.example.com/spa']
      : [],
  )

  it('presents the verified version in every language it was published in', () => {
    const outcome = buildLivePortalPreview({ snapshot, approvedUris: allApproved })

    expect(outcome.status).toBe('ready')
    if (outcome.status !== 'ready') return
    expect(outcome.preview).toMatchObject({
      source: 'live',
      version: 6,
      primaryLocale: 'en',
      locales: ['en', 'bg'],
      privateFeedbackThreshold: 3,
    })
    expect(experienceOf(outcome.preview, 'bg').content.title.value).toBe(
      'Разкажете ни за посещението си',
    )
    expect(experienceOf(outcome.preview, 'en').links.map((link) => link.state)).toEqual([
      'ready',
      'ready',
    ])
  })

  it('leaves out a tile whose approval has lapsed, as the guest page does', () => {
    const outcome = buildLivePortalPreview({
      snapshot,
      approvedUris: new Set(['https://harbor.example.com/menu']),
    })

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(experienceOf(outcome.preview, 'en').links.map((link) => link.label)).toEqual([
      'Menu',
    ])
  })

  it('shows no tiles when the Linktree is switched off', () => {
    const off = immersiveSnapshot(
      immersiveConfiguration({ linktree: { enabled: false } }),
    )

    const outcome = buildLivePortalPreview({ snapshot: off, approvedUris: allApproved })

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(experienceOf(outcome.preview, 'en')).toMatchObject({
      linktree: { enabled: false },
      links: [],
    })
  })

  it('never puts an address or an asset id into the preview', () => {
    const outcome = buildLivePortalPreview({ snapshot, approvedUris: allApproved })

    const json = JSON.stringify(outcome)
    expect(json).not.toContain('harbor.example.com/menu')
    expect(json).not.toContain('70000000-0000-4000-8000')
  })

  it('has no photo to show for an image nothing says may be served', () => {
    const outcome = buildLivePortalPreview({ snapshot, approvedUris: allApproved })

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(experienceOf(outcome.preview, 'en').brand).toMatchObject({
      hero: null,
      logo: null,
    })
  })

  it('shows the photo and logo of the live version when their addresses are given, and none that were not', () => {
    const outcome = buildLivePortalPreview({
      snapshot,
      approvedUris: allApproved,
      mediaUrls: {
        [IMMERSIVE_HERO_ASSET_ID]: '/api/public/portal-media/hero',
        [IMMERSIVE_LOGO_ASSET_ID]: '/api/public/portal-media/logo',
      },
    })

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    const { brand } = experienceOf(outcome.preview, 'en')
    expect(brand.hero?.url).toBe('/api/public/portal-media/hero')
    expect(brand.logo?.url).toBe('/api/public/portal-media/logo')
  })

  it('says the version is incomplete when an approved tile has no words in a language it offers', () => {
    const configuration = immersiveConfiguration()
    const [first, ...rest] = configuration.links
    if (!first) throw new Error('the fixture has no links')
    const { bg: _omitted, ...onlyEnglish } = first.texts
    const broken = immersiveSnapshot({
      ...configuration,
      links: [{ ...first, texts: onlyEnglish }, ...rest],
    })

    expect(
      buildLivePortalPreview({ snapshot: broken, approvedUris: allApproved }),
    ).toEqual({
      status: 'unavailable',
      source: 'live',
      reason: 'incomplete',
    })
  })

  it('does not preview a version published with the earlier page design', () => {
    const legacy = {
      ...snapshot,
      configuration: { ...snapshot.configuration, schemaVersion: 2 },
    } as unknown as typeof snapshot

    expect(
      buildLivePortalPreview({ snapshot: legacy, approvedUris: allApproved }),
    ).toEqual({
      status: 'unavailable',
      source: 'live',
      reason: 'earlier_design',
    })
  })
})
