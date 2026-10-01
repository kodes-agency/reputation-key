import { describe, expect, it } from 'vitest'
import {
  buildTestPortal,
  buildTestPortalLink,
  buildTestPortalLinkCategory,
} from '#/shared/testing/fixtures'
import {
  organizationId,
  portalApprovedDestinationId,
  portalId,
  portalLinkCategoryId,
  portalLinkId,
} from '#/shared/domain/ids'
import type { ResolvedPortalLinkText } from '../domain/portal-linktree'
import type { PortalLocalizedOverride } from './ports/portal-experience.repository'
import type { NewPortalLocales } from '../domain/portal-new-locales'
import { planPortalContentCopy, type PortalCopySource } from './portal-content-copy'

const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const SOURCE = portalId('d0000000-0000-0000-0000-0000000000a1')
const TARGET = portalId('d0000000-0000-0000-0000-0000000000b2')
const NOW = new Date('2026-10-01T10:00:00Z')
const DESTINATION = portalApprovedDestinationId('de000000-0000-0000-0000-000000000001')

const sequentialIds = () => {
  let next = 0
  return () => `00000000-0000-0000-0000-${String(++next).padStart(12, '0')}`
}

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
  updatedAt: NOW,
  source: 'text',
})

const override = (
  locale: PortalLocalizedOverride['locale'],
  patch: Partial<PortalLocalizedOverride>,
): PortalLocalizedOverride => ({
  id: `ov-${locale}`,
  organizationId: ORG,
  propertyId: buildTestPortal().propertyId,
  portalId: SOURCE,
  locale,
  title: null,
  shortDescription: null,
  heroImageUrl: null,
  linktreeTitle: null,
  version: 3,
  updatedBy: 'user-1' as never,
  createdAt: NOW,
  updatedAt: NOW,
  ...patch,
})

const linkOf = (
  id: string,
  categoryId: string,
  sortKey: string,
  destination: typeof DESTINATION | null = DESTINATION,
) =>
  buildTestPortalLink({
    id: portalLinkId(id),
    portalId: SOURCE,
    categoryId: portalLinkCategoryId(categoryId),
    destinationId: destination,
    legacyDestinationState: destination ? 'migrated' : 'unclassified',
    label: `label-${id}`,
    sortKey,
    iconKey: 'map-pin',
  })

function source(patch: Partial<PortalCopySource> = {}): PortalCopySource {
  return {
    portal: buildTestPortal({
      id: SOURCE,
      primaryGuestLocale: 'en',
      additionalGuestLocales: ['bg'],
      description: 'Welcome to the pool',
      privateFeedbackThreshold: 4,
      linktreeEnabled: false,
      theme: { primaryColor: '#112233' },
    }),
    overrides: [],
    categories: [],
    links: [],
    linkTexts: [],
    ...patch,
  }
}

const plan = (
  src: PortalCopySource,
  locales: NewPortalLocales = { primary: 'en', additional: ['bg'] },
) =>
  planPortalContentCopy({
    source: src,
    target: { portalId: TARGET, locales },
    idGen: sequentialIds(),
    now: NOW,
  })

describe('planPortalContentCopy', () => {
  it('carries the settings of the source Portal', () => {
    const { settings } = plan(source())
    expect(settings).toEqual({
      description: 'Welcome to the pool',
      privateFeedbackThreshold: 4,
      linktreeEnabled: false,
      theme: { primaryColor: '#112233' },
    })
  })

  it('copies wording for the languages the new Portal offers, with fresh ids and no photo', () => {
    const { content } = plan(
      source({
        overrides: [
          override('en', { title: 'Pool', heroImageUrl: 'https://cdn/x.jpg' }),
          override('bg', { shortDescription: 'Басейн', linktreeTitle: 'Връзки' }),
          override('es', { title: 'Piscina' }),
        ],
      }),
    )
    expect(content.overrides).toEqual([
      {
        id: expect.any(String),
        locale: 'en',
        title: 'Pool',
        shortDescription: null,
        linktreeTitle: null,
      },
      {
        id: expect.any(String),
        locale: 'bg',
        title: null,
        shortDescription: 'Басейн',
        linktreeTitle: 'Връзки',
      },
    ])
    expect(content.overrides.map((o) => o.id)).not.toContain('ov-en')
  })

  it('skips wording that only held a photo', () => {
    const { content } = plan(
      source({ overrides: [override('en', { heroImageUrl: 'https://cdn/x.jpg' })] }),
    )
    expect(content.overrides).toEqual([])
  })

  it('copies approved links and their categories onto the new Portal, in order', () => {
    const cat = buildTestPortalLinkCategory({
      id: portalLinkCategoryId('c0000000-0000-0000-0000-00000000000a'),
      portalId: SOURCE,
      title: 'Food',
      sortKey: 'a0',
    })
    const { content } = plan(
      source({
        categories: [cat],
        links: [
          linkOf('10000000-0000-0000-0000-000000000002', cat.id, 'a1'),
          linkOf('10000000-0000-0000-0000-000000000001', cat.id, 'a0'),
        ],
        linkTexts: [
          text('10000000-0000-0000-0000-000000000001', 'en', 'Menu', 'Today'),
          text('10000000-0000-0000-0000-000000000001', 'bg', 'Меню'),
          text('10000000-0000-0000-0000-000000000002', 'en', 'Spa'),
        ],
      }),
    )
    expect(content.categories).toHaveLength(1)
    const [category] = content.categories
    expect(category).toMatchObject({
      portalId: TARGET,
      organizationId: ORG,
      title: 'Food',
    })
    expect(category?.id).not.toBe(cat.id)
    expect(content.links.map((l) => l.label)).toEqual(['Menu', 'Spa'])
    expect(content.links.every((l) => l.portalId === TARGET)).toBe(true)
    expect(content.links.every((l) => l.categoryId === category?.id)).toBe(true)
    expect(content.links.every((l) => l.destinationId === DESTINATION)).toBe(true)
    expect(content.links.every((l) => l.iconKey === 'map-pin')).toBe(true)
    const [menu] = content.links
    expect(content.linkTexts.filter((t) => t.linkId === menu?.id)).toEqual([
      { linkId: menu?.id, locale: 'en', label: 'Menu', line: 'Today', provenance: null },
      { linkId: menu?.id, locale: 'bg', label: 'Меню', line: null, provenance: null },
    ])
  })

  it('does not copy a link that is not an approved destination', () => {
    const cat = buildTestPortalLinkCategory({ portalId: SOURCE })
    const { content } = plan(
      source({
        categories: [cat],
        links: [linkOf('10000000-0000-0000-0000-000000000009', cat.id, 'a0', null)],
        linkTexts: [text('10000000-0000-0000-0000-000000000009', 'en', 'Old link')],
      }),
    )
    expect(content.links).toEqual([])
    expect(content.categories).toEqual([])
    expect(content.linkTexts).toEqual([])
  })

  it('keeps a Portal within the link limit', () => {
    const cat = buildTestPortalLinkCategory({ portalId: SOURCE })
    const ids = [1, 2, 3, 4, 5, 6].map((n) => `10000000-0000-0000-0000-00000000000${n}`)
    const { content } = plan(
      source({
        categories: [cat],
        links: ids.map((id, index) => linkOf(id, cat.id, `a${index}`)),
        linkTexts: ids.map((id) => text(id, 'en', `text-${id.slice(-1)}`)),
      }),
    )
    expect(content.links).toHaveLength(4)
    expect(
      content.linkTexts.every((t) => content.links.some((l) => l.id === t.linkId)),
    ).toBe(true)
  })

  it('leaves out the texts of languages the new Portal does not offer', () => {
    const cat = buildTestPortalLinkCategory({ portalId: SOURCE })
    const id = '10000000-0000-0000-0000-000000000001'
    const { content } = plan(
      source({
        categories: [cat],
        links: [linkOf(id, cat.id, 'a0')],
        linkTexts: [text(id, 'en', 'Menu'), text(id, 'bg', 'Меню')],
      }),
      { primary: 'en', additional: [] },
    )
    expect(content.linkTexts.map((t) => t.locale)).toEqual(['en'])
  })

  it('names each link in the new primary language, falling back to the source primary text', () => {
    const cat = buildTestPortalLinkCategory({ portalId: SOURCE })
    const id = '10000000-0000-0000-0000-000000000001'
    const { content } = plan(
      source({
        categories: [cat],
        links: [linkOf(id, cat.id, 'a0')],
        linkTexts: [text(id, 'en', 'Menu')],
      }),
      { primary: 'bg', additional: ['en'] },
    )
    const [link] = content.links
    // No Bulgarian text exists, so the English label stands in: no link is unnamed.
    expect(link?.label).toBe('Menu')
    expect(content.linkTexts.map((t) => [t.locale, t.label])).toEqual([
      ['bg', 'Menu'],
      ['en', 'Menu'],
    ])
  })

  it('uses the link label when the source has no text at all for its primary language', () => {
    const cat = buildTestPortalLinkCategory({ portalId: SOURCE })
    const id = '10000000-0000-0000-0000-000000000001'
    const { content } = plan(
      source({ categories: [cat], links: [linkOf(id, cat.id, 'a0')], linkTexts: [] }),
    )
    expect(content.links.map((l) => l.label)).toEqual([`label-${id}`])
    expect(content.linkTexts).toEqual([
      expect.objectContaining({ locale: 'en', label: `label-${id}` }),
    ])
  })

  it('never carries anything that belongs to codes, publications or managers', () => {
    const { content, settings } = plan(source())
    expect(Object.keys(content).sort()).toEqual([
      'categories',
      'linkTexts',
      'links',
      'overrides',
      'sourcePortalId',
    ])
    expect(Object.keys(settings).sort()).toEqual([
      'description',
      'linktreeEnabled',
      'privateFeedbackThreshold',
      'theme',
    ])
    expect(content.sourcePortalId).toBe(SOURCE)
  })
})
