import { describe, expect, it } from 'vitest'
import {
  GOLDEN_V1_ROW,
  GOLDEN_V2_BG_PRIMARY_ROW,
  GOLDEN_V2_SEEDED_ROW,
} from '../application/__fixtures__/publication-snapshots.golden'
import {
  bulgarianPrimaryConfiguration,
  immersiveConfiguration,
} from './__fixtures__/immersive-configuration'
import {
  diffPublicationContent,
  publicationContentView,
} from './portal-publication-content'
import type {
  ImmersiveLink,
  ImmersivePortalPublicationConfiguration,
  LocalizedPortalPublicationConfiguration,
  PortalPublicationConfiguration,
} from './portal-publication-snapshot'

const v1 = GOLDEN_V1_ROW.configuration as unknown as PortalPublicationConfiguration
const v2 =
  GOLDEN_V2_SEEDED_ROW.configuration as unknown as LocalizedPortalPublicationConfiguration
const v2Bg =
  GOLDEN_V2_BG_PRIMARY_ROW.configuration as unknown as PortalPublicationConfiguration
const v3 = immersiveConfiguration()

const own = <T>(value: T) => ({ value, fallbackFrom: null }) as const

const withLinks = (
  links: readonly ImmersiveLink[],
  overrides: Partial<ImmersivePortalPublicationConfiguration> = {},
): ImmersivePortalPublicationConfiguration => ({ ...v3, links, ...overrides })

const [menu, spa] = v3.links as [ImmersiveLink, ImmersiveLink]
const dinner: ImmersiveLink = {
  id: '30000000-0000-4000-8000-000000000009',
  url: 'https://harbor.example.com/dinner',
  iconKey: null,
  imageAssetId: '70000000-0000-4000-8000-000000000009',
  texts: {
    en: { label: 'Dinner', line: null, fallbackFrom: null },
    bg: { label: 'Вечеря', line: null, fallbackFrom: null },
  },
}

describe('publicationContentView', () => {
  it('reads a v1 snapshot as a single-language legacy page', () => {
    const view = publicationContentView(v1)

    expect(view.surface).toBe('legacy')
    expect(view.locales).toEqual(['en'])
    expect(view.links.map((link) => link.label)).toEqual([
      'Visit example review destination',
    ])
    expect(view.linktreeEnabled).toBeNull()
    expect(view.wording.en?.title).toBe('Golden Portal')
  })

  it('reads a v2 snapshot with its languages and per-language wording', () => {
    const view = publicationContentView(v2)

    expect(view.locales).toEqual(['en', 'bg'])
    expect(view.wording.bg?.title).toBe('E2E Guest Portal P1 (BG)')
    expect(view.look.name).toBe('E2E Test Organization')
  })

  it('keeps the primary language first in a Bulgarian-primary v2 snapshot', () => {
    expect(publicationContentView(v2Bg).primaryLocale).toBe('bg')
  })

  it('reads a v3 snapshot with the label of each tile in the primary language', () => {
    const view = publicationContentView(v3)

    expect(view.surface).toBe('immersive')
    expect(view.links.map((link) => link.label)).toEqual(['Menu', 'Spa'])
    expect(view.links[1]?.hasPhoto).toBe(true)
    expect(view.linktreeEnabled).toBe(true)
  })

  it('orders legacy links by category and then by position', () => {
    const configuration = {
      ...v2,
      categories: [
        { id: 'c-b', title: 'B', sortKey: 'b0' },
        { id: 'c-a', title: 'A', sortKey: 'a0' },
      ],
      links: [
        {
          id: 'l1',
          label: 'In B',
          url: 'https://x.test/1',
          categoryId: 'c-b',
          sortKey: 'a0',
        },
        {
          id: 'l2',
          label: 'Loose',
          url: 'https://x.test/2',
          categoryId: null,
          sortKey: 'a0',
        },
        {
          id: 'l3',
          label: 'In A second',
          url: 'https://x.test/3',
          categoryId: 'c-a',
          sortKey: 'b0',
        },
        {
          id: 'l4',
          label: 'In A first',
          url: 'https://x.test/4',
          categoryId: 'c-a',
          sortKey: 'a0',
        },
      ],
    } satisfies LocalizedPortalPublicationConfiguration

    expect(publicationContentView(configuration).links.map((link) => link.label)).toEqual(
      ['In A first', 'In A second', 'In B', 'Loose'],
    )
  })
})

describe('diffPublicationContent', () => {
  it('reports nothing for the same configuration, whatever its schema version', () => {
    for (const configuration of [v1, v2, v2Bg, v3]) {
      expect(diffPublicationContent(configuration, configuration)).toEqual([])
    }
  })

  it('treats the first version as everything added', () => {
    expect(diffPublicationContent(null, v3)).toEqual([
      { kind: 'language_added', locale: 'en' },
      { kind: 'language_added', locale: 'bg' },
      { kind: 'link_added', label: 'Menu', hasPhoto: false },
      { kind: 'link_added', label: 'Spa', hasPhoto: true },
    ])
  })

  it('names an added and a removed language', () => {
    const withoutBg = {
      ...v3,
      localeSet: ['en'],
      languagePackVersions: { en: 'guest-ui-en-v2' },
      localizedContent: { en: v3.localizedContent.en! },
      links: v3.links.map((link) => ({ ...link, texts: { en: link.texts.en! } })),
    } satisfies ImmersivePortalPublicationConfiguration

    expect(diffPublicationContent(withoutBg, v3)).toContainEqual({
      kind: 'language_added',
      locale: 'bg',
    })
    expect(diffPublicationContent(v3, withoutBg)).toContainEqual({
      kind: 'language_removed',
      locale: 'bg',
    })
  })

  it('names a primary language change', () => {
    expect(diffPublicationContent(v3, bulgarianPrimaryConfiguration())).toContainEqual({
      kind: 'primary_language_changed',
      from: 'en',
      to: 'bg',
    })
  })

  it('names an added tile, with whether it carries a photo', () => {
    expect(diffPublicationContent(v3, withLinks([menu, spa, dinner]))).toEqual([
      { kind: 'link_added', label: 'Dinner', hasPhoto: true },
    ])
  })

  it('names a removed tile', () => {
    expect(diffPublicationContent(v3, withLinks([menu]))).toEqual([
      { kind: 'link_removed', label: 'Spa', hasPhoto: true },
    ])
  })

  it('names a renamed tile once, by its primary-language label', () => {
    const renamed: ImmersiveLink = {
      ...menu,
      texts: {
        ...menu.texts,
        en: { label: 'Olive menu', line: 'Breakfast until 11', fallbackFrom: null },
      },
    }

    expect(diffPublicationContent(v3, withLinks([renamed, spa]))).toEqual([
      { kind: 'link_renamed', from: 'Menu', to: 'Olive menu' },
    ])
  })

  it('names a tile whose line or another language label was reworded', () => {
    const reworded: ImmersiveLink = {
      ...menu,
      texts: {
        en: { label: 'Menu', line: 'Breakfast until noon', fallbackFrom: null },
        bg: { label: 'Менюто', line: 'Закуска до 11', fallbackFrom: null },
      },
    }

    expect(diffPublicationContent(v3, withLinks([reworded, spa]))).toEqual([
      { kind: 'link_reworded', label: 'Menu', locale: 'en' },
      { kind: 'link_reworded', label: 'Menu', locale: 'bg' },
    ])
  })

  it('names a tile whose address changed', () => {
    const moved: ImmersiveLink = { ...menu, url: 'https://harbor.example.com/new-menu' }

    expect(diffPublicationContent(v3, withLinks([moved, spa]))).toEqual([
      { kind: 'link_address_changed', label: 'Menu' },
    ])
  })

  it('names a reorder only among the tiles both versions have', () => {
    expect(diffPublicationContent(v3, withLinks([spa, menu]))).toEqual([
      { kind: 'links_reordered' },
    ])
    expect(diffPublicationContent(v3, withLinks([menu, spa, dinner]))).not.toContainEqual(
      {
        kind: 'links_reordered',
      },
    )
  })

  it('names the Linktree switch', () => {
    expect(diffPublicationContent(v3, { ...v3, linktree: { enabled: false } })).toEqual([
      { kind: 'linktree_switched', enabled: false },
    ])
  })

  it('names reworded titles, descriptions, photo descriptions and section titles by language', () => {
    const en = v3.localizedContent.en!
    const changed = {
      ...v3,
      localizedContent: {
        ...v3.localizedContent,
        en: {
          title: own('How was your stay?'),
          shortDescription: own('Rate it.'),
          heroAlt: own('Dusk'),
          linktreeTitle: own('Around the hotel'),
        },
      },
    } satisfies ImmersivePortalPublicationConfiguration

    expect(en.title.value).not.toBe(changed.localizedContent.en.title.value)
    expect(diffPublicationContent(v3, changed)).toEqual([
      { kind: 'wording_changed', field: 'title', locale: 'en' },
      { kind: 'wording_changed', field: 'description', locale: 'en' },
      { kind: 'wording_changed', field: 'photo_description', locale: 'en' },
      { kind: 'wording_changed', field: 'linktree_title', locale: 'en' },
    ])
  })

  it('names which parts of the look changed', () => {
    const restyled = {
      ...v3,
      brandProfile: {
        ...v3.brandProfile,
        accentColour: '#112233',
        hero: null,
        wordmark: 'AVELA',
      },
    } satisfies ImmersivePortalPublicationConfiguration

    expect(diffPublicationContent(v3, restyled)).toEqual([
      { kind: 'look_changed', facets: ['colours', 'wordmark', 'photo'] },
    ])
  })

  it('names the private-feedback threshold and the Google address', () => {
    const changed = {
      ...v3,
      reviewGateway: {
        privateFeedbackThreshold: 4,
        googleReview: {
          status: 'available',
          uri: 'https://search.google.com/local/writereview?placeid=other',
        },
      },
    } satisfies ImmersivePortalPublicationConfiguration

    expect(diffPublicationContent(v3, changed)).toEqual([
      { kind: 'feedback_threshold_changed', from: 3, to: 4 },
      { kind: 'review_address_changed' },
    ])
  })

  it('compares a v1 page with a v2 page without inventing a look change', () => {
    const changes = diffPublicationContent(v1, v2)

    expect(changes.some((change) => change.kind === 'look_changed')).toBe(false)
    expect(changes).toContainEqual({ kind: 'language_added', locale: 'bg' })
  })

  it('says the design changed, and nothing about colours, across the legacy and Immersive pages', () => {
    const changes = diffPublicationContent(v2, v3)

    expect(changes).toContainEqual({ kind: 'design_changed', to: 'immersive' })
    expect(changes.some((change) => change.kind === 'look_changed')).toBe(false)
    expect(diffPublicationContent(v3, v2)).toContainEqual({
      kind: 'design_changed',
      to: 'legacy',
    })
  })

  it('does not call a legacy page with links a Linktree switch', () => {
    const switchedOn = { ...v3, linktree: { enabled: true } }

    expect(
      diffPublicationContent(v2, switchedOn).some(
        (change) => change.kind === 'linktree_switched',
      ),
    ).toBe(false)
  })

  it('reports the opposite change in the opposite direction', () => {
    const forward = diffPublicationContent(v3, withLinks([menu, spa, dinner]))
    const back = diffPublicationContent(withLinks([menu, spa, dinner]), v3)

    expect(forward).toEqual([{ kind: 'link_added', label: 'Dinner', hasPhoto: true }])
    expect(back).toEqual([{ kind: 'link_removed', label: 'Dinner', hasPhoto: true }])
  })
})
