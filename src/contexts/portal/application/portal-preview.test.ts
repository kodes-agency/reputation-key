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
  immersiveConfiguration,
  immersiveSnapshot,
} from './__fixtures__/immersive-snapshot'
import { buildDraftPortalPreview, buildLivePortalPreview } from './portal-preview'
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

  it('draws the look from the Brand Profile: accent, derived field, wordmark, photo', () => {
    const { brand } = experienceOf(draft(), 'en')

    expect(brand).toMatchObject({
      displayName: 'Avela Resort',
      wordmark: 'AVELA',
      accentColour: '#C8A45A',
      logo: null,
      hero: { url: 'https://photos.example.test/avela.jpg', focalX: 0.5, focalY: 0.5 },
    })
    expect(brand.fieldColour).toMatch(/^#[0-9A-F]{6}$/)
    expect(brand.fieldColour).not.toBe('#14110F')
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

  it('has no photo to show until media can be served', () => {
    const outcome = buildLivePortalPreview({ snapshot, approvedUris: allApproved })

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(experienceOf(outcome.preview, 'en').brand).toMatchObject({
      hero: null,
      logo: null,
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
