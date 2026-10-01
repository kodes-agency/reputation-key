import { describe, expect, it } from 'vitest'
import {
  buildPortalLinktreeView,
  orderLinksForLinktree,
  summarizeLinkDestination,
} from './portal-linktree-view'
import type { PortalApprovedDestination } from './approved-destination'
import type { ResolvedPortalLinkText } from './portal-linktree'
import {
  buildTestPortal,
  buildTestPortalLink,
  buildTestPortalLinkCategory,
} from '#/shared/testing/fixtures'
import {
  portalApprovedDestinationId,
  portalLinkCategoryId,
  portalLinkId,
  portalMediaAssetId,
  userId,
} from '#/shared/domain/ids'

const AT = new Date('2026-10-01T10:00:00Z')

const destination = (
  overrides: Partial<PortalApprovedDestination> = {},
): PortalApprovedDestination => ({
  id: portalApprovedDestinationId('20000000-0000-0000-0000-000000000001'),
  organizationId: buildTestPortalLink().organizationId,
  propertyId: buildTestPortalLink().propertyId,
  normalizedUri: 'https://avela.bg/menu',
  hostname: 'avela.bg',
  sourceType: 'custom',
  approvalState: 'approved',
  validationVersion: 'portal-destination-https-v1',
  requestedBy: userId('user-1'),
  approvedBy: userId('admin-1'),
  approvedAt: AT,
  disabledAt: null,
  disabledReason: null,
  lastValidatedAt: AT,
  createdAt: AT,
  updatedAt: AT,
  ...overrides,
})

const text = (
  linkId: string,
  locale: ResolvedPortalLinkText['locale'],
  label: string,
  overrides: Partial<ResolvedPortalLinkText> = {},
): ResolvedPortalLinkText => ({
  linkId,
  locale,
  label,
  line: null,
  provenance: null,
  version: 1,
  updatedBy: 'user-1',
  updatedAt: AT,
  source: 'text',
  ...overrides,
})

describe('orderLinksForLinktree', () => {
  it('orders by category, then by the link order inside it, as the guest page flattens them', () => {
    const first = buildTestPortalLinkCategory({
      id: portalLinkCategoryId('c1'),
      sortKey: 'a0',
    })
    const second = buildTestPortalLinkCategory({
      id: portalLinkCategoryId('c2'),
      sortKey: 'a1',
    })
    const links = [
      buildTestPortalLink({
        id: portalLinkId('l-3'),
        categoryId: second.id,
        sortKey: 'a0',
      }),
      buildTestPortalLink({
        id: portalLinkId('l-2'),
        categoryId: first.id,
        sortKey: 'a1',
      }),
      buildTestPortalLink({
        id: portalLinkId('l-1'),
        categoryId: first.id,
        sortKey: 'a0',
      }),
    ]

    expect(orderLinksForLinktree([second, first], links).map((link) => link.id)).toEqual([
      'l-1',
      'l-2',
      'l-3',
    ])
  })

  it('breaks a tie on the link id so the order never depends on the read', () => {
    const category = buildTestPortalLinkCategory({})
    const links = ['l-b', 'l-a'].map((id) =>
      buildTestPortalLink({
        id: portalLinkId(id),
        categoryId: category.id,
        sortKey: 'a0',
      }),
    )

    expect(orderLinksForLinktree([category], links).map((link) => link.id)).toEqual([
      'l-a',
      'l-b',
    ])
  })
})

describe('summarizeLinkDestination', () => {
  it('names who approved an approved destination', () => {
    const approved = destination()
    const link = buildTestPortalLink({ destinationId: approved.id })

    expect(summarizeLinkDestination(link, new Map([[approved.id, approved]]))).toEqual({
      state: 'approved',
      sourceType: 'custom',
      approvedByUserId: 'admin-1',
    })
  })

  it.each(['pending', 'disabled', 'quarantined'] as const)(
    'reports a %s destination without an approver',
    (approvalState) => {
      const item = destination({ approvalState, approvedBy: null, approvedAt: null })
      const link = buildTestPortalLink({ destinationId: item.id })

      expect(summarizeLinkDestination(link, new Map([[item.id, item]]))).toEqual({
        state: approvalState,
        sourceType: 'custom',
        approvedByUserId: null,
      })
    },
  )

  it('calls a link with no destination unclassified, or quarantined when it was set aside', () => {
    expect(
      summarizeLinkDestination(
        buildTestPortalLink({
          destinationId: null,
          legacyDestinationState: 'unclassified',
        }),
        new Map(),
      ).state,
    ).toBe('unclassified')
    expect(
      summarizeLinkDestination(
        buildTestPortalLink({
          destinationId: null,
          legacyDestinationState: 'quarantined',
        }),
        new Map(),
      ).state,
    ).toBe('quarantined')
  })

  it('treats a destination that cannot be found as unclassified, never as approved', () => {
    const link = buildTestPortalLink({
      destinationId: portalApprovedDestinationId('20000000-0000-0000-0000-0000000000ff'),
    })

    expect(summarizeLinkDestination(link, new Map()).state).toBe('unclassified')
  })
})

describe('buildPortalLinktreeView', () => {
  const portal = buildTestPortal({
    primaryGuestLocale: 'en',
    additionalGuestLocales: ['bg'],
    linktreeEnabled: false,
  })
  const category = buildTestPortalLinkCategory({})
  const linkA = buildTestPortalLink({
    id: portalLinkId('l-a'),
    categoryId: category.id,
    sortKey: 'a0',
    iconKey: 'utensils',
  })
  const linkB = buildTestPortalLink({
    id: portalLinkId('l-b'),
    categoryId: category.id,
    sortKey: 'a1',
  })

  it('carries the switch, the languages the Portal offers and the cap', () => {
    const view = buildPortalLinktreeView({
      portal,
      categories: [category],
      links: [],
      texts: [],
      titles: [],
      destinations: [],
    })

    expect(view).toMatchObject({
      portalId: portal.id,
      enabled: false,
      maxLinks: 4,
      primaryLocale: 'en',
      locales: ['en', 'bg'],
      links: [],
      titles: {},
    })
  })

  it('gives each link its own texts, its icon and its approval', () => {
    const approved = destination()
    const view = buildPortalLinktreeView({
      portal,
      categories: [category],
      links: [{ ...linkB }, { ...linkA, destinationId: approved.id }],
      texts: [
        text('l-b', 'en', 'Spa'),
        text('l-a', 'en', 'Menu', { line: 'Lunch and dinner' }),
        text('l-a', 'bg', 'Меню', { provenance: 'ai_draft' }),
      ],
      titles: [],
      destinations: [approved],
    })

    expect(view.links.map((link) => link.id)).toEqual(['l-a', 'l-b'])
    expect(view.links[0]).toMatchObject({
      id: 'l-a',
      iconKey: 'utensils',
      url: linkA.url,
      texts: [
        { locale: 'en', label: 'Menu', line: 'Lunch and dinner', provenance: null },
        { locale: 'bg', label: 'Меню', line: null, provenance: 'ai_draft' },
      ],
      destination: { state: 'approved', approvedByUserId: 'admin-1' },
    })
    expect(view.links[1]?.texts.map((entry) => entry.label)).toEqual(['Spa'])
  })

  it('keeps only the titles a manager wrote, per language', () => {
    const view = buildPortalLinktreeView({
      portal,
      categories: [category],
      links: [],
      texts: [],
      titles: [
        { locale: 'en', linktreeTitle: 'Around the resort' },
        { locale: 'bg', linktreeTitle: null },
      ],
      destinations: [],
    })

    expect(view.titles).toEqual({ en: 'Around the resort' })
  })

  it('ignores a text whose link is not in the list', () => {
    const view = buildPortalLinktreeView({
      portal,
      categories: [category],
      links: [linkA],
      texts: [text('someone-elses-link', 'en', 'Secret')],
      titles: [],
      destinations: [],
    })

    expect(view.links[0]?.texts).toEqual([])
  })
})

describe('buildPortalLinktreeView tile pictures', () => {
  const build = (links: ReturnType<typeof buildTestPortalLink>[]) =>
    buildPortalLinktreeView({
      portal: buildTestPortal({}),
      categories: [buildTestPortalLinkCategory({})],
      links,
      texts: [],
      titles: [],
      destinations: [],
    })

  it('hands the editor the asset id of a tile that has a picture, and null for one that has none', () => {
    const view = build([
      buildTestPortalLink({
        id: portalLinkId('l-1'),
        sortKey: 'a0',
        imageAssetId: portalMediaAssetId('30000000-0000-4000-8000-000000000001'),
      }),
      buildTestPortalLink({ id: portalLinkId('l-2'), sortKey: 'a1' }),
    ])

    expect(view.links.map((link) => [link.id, link.imageAssetId])).toEqual([
      ['l-1', '30000000-0000-4000-8000-000000000001'],
      ['l-2', null],
    ])
  })
})
