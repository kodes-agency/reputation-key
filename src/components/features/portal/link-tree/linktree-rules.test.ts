import { describe, expect, it } from 'vitest'
import {
  applyLinkOrder,
  describeLinkCap,
  isAddressWrite,
  linkLabelFor,
  describeUnsavedLine,
  linkLocaleChips,
  offeredLocales,
  planLinkMove,
  requiredTextLocales,
  textsFormValues,
  toLinkTextsInput,
  toLinktreeTitlesInput,
  titlesFormValues,
} from './linktree-rules'
import type { PortalLinktreeLink } from '#/contexts/portal/application/public-api'

const link = (
  id: string,
  categoryId: string,
  sortKey: string,
  overrides: Partial<PortalLinktreeLink> = {},
): PortalLinktreeLink => ({
  id,
  categoryId,
  url: `https://avela.bg/${id}`,
  iconKey: null,
  imageAssetId: null,
  sortKey,
  texts: [{ locale: 'en', label: id.toUpperCase(), line: null, provenance: null }],
  destination: { state: 'approved', sourceType: 'custom', approvedByUserId: 'admin-1' },
  ...overrides,
})

describe('offeredLocales', () => {
  it("keeps the languages a manager can write in, in the Portal's own order", () => {
    expect(offeredLocales(['bg', 'en'])).toEqual(['bg', 'en'])
    expect(offeredLocales(['en', 'bg'])).toEqual(['en', 'bg'])
  })

  it('keeps every guest language, since each has a pack', () => {
    expect(offeredLocales(['en', 'es', 'it', 'fr', 'de', 'bg'])).toEqual([
      'en',
      'es',
      'it',
      'fr',
      'de',
      'bg',
    ])
  })

  it('drops a language outside the catalogue', () => {
    expect(offeredLocales(['en', 'pt' as never])).toEqual(['en'])
  })
})

describe('describeLinkCap', () => {
  it('counts the tiles in use against the cap', () => {
    expect(describeLinkCap(2, 4)).toEqual({ text: '2 of 4 tiles in use', isFull: false })
  })

  it('says so when the last tile is taken', () => {
    expect(describeLinkCap(4, 4)).toEqual({ text: '4 of 4 tiles in use', isFull: true })
  })

  it('keeps a Portal that already has more than the cap full, without a negative room', () => {
    expect(describeLinkCap(6, 4)).toEqual({ text: '6 of 4 tiles in use', isFull: true })
  })

  it('counts the tiles guests cannot see, so a full list is not taken for a live one', () => {
    expect(describeLinkCap(4, 4, 1)).toEqual({
      text: '4 of 4 tiles in use · 1 hidden from guests',
      isFull: true,
    })
    expect(describeLinkCap(2, 4, 0).text).toBe('2 of 4 tiles in use')
  })
})

describe('linkLabelFor', () => {
  it('prefers the primary language, then any text, then nothing', () => {
    const tile = link('a', 'c1', 'a0', {
      texts: [
        { locale: 'bg', label: 'Меню', line: null, provenance: null },
        { locale: 'en', label: 'Menu', line: 'Lunch', provenance: null },
      ],
    })

    expect(linkLabelFor(tile, 'en')).toEqual({ label: 'Menu', line: 'Lunch' })
    expect(linkLabelFor(tile, 'de')).toEqual({ label: 'Меню', line: null })
    expect(linkLabelFor(link('b', 'c1', 'a1', { texts: [] }), 'en')).toEqual({
      label: '',
      line: null,
    })
  })
})

describe('linkLocaleChips', () => {
  it('marks a language with no text as missing, and the primary as written', () => {
    const tile = link('a', 'c1', 'a0')

    expect(linkLocaleChips(tile, ['en', 'bg'])).toEqual([
      { locale: 'en', chip: 'EN', name: 'English', isMissing: false },
      { locale: 'bg', chip: 'BG', name: 'Bulgarian', isMissing: true },
    ])
  })

  it('does not call a blank text written', () => {
    const tile = link('a', 'c1', 'a0', {
      texts: [
        { locale: 'en', label: 'Menu', line: null, provenance: null },
        { locale: 'bg', label: '  ', line: null, provenance: null },
      ],
    })

    expect(linkLocaleChips(tile, ['en', 'bg']).map((chip) => chip.isMissing)).toEqual([
      false,
      true,
    ])
  })
})

describe('planLinkMove', () => {
  const tiles = [
    link('a', 'c1', 'a0'),
    link('b', 'c1', 'a1'),
    link('c', 'c1', 'a2'),
    link('d', 'c2', 'a0'),
  ]

  it('swaps a link with its neighbour and rewrites the keys of its group', () => {
    const plan = planLinkMove(tiles, 'b', 'up')

    expect(plan?.categoryId).toBe('c1')
    expect(plan?.items.map((item) => item.id)).toEqual(['b', 'a', 'c'])
    const keys = plan?.items.map((item) => item.sortKey) ?? []
    expect([...keys].sort()).toEqual(keys)
    expect(new Set(keys).size).toBe(3)
  })

  it('moves down as well', () => {
    expect(planLinkMove(tiles, 'a', 'down')?.items.map((item) => item.id)).toEqual([
      'b',
      'a',
      'c',
    ])
  })

  it('offers no move past either end of the list', () => {
    expect(planLinkMove(tiles, 'a', 'up')).toBeNull()
    expect(planLinkMove(tiles, 'd', 'down')).toBeNull()
  })

  it('does not move a link across the edge of an older category', () => {
    expect(planLinkMove(tiles, 'c', 'down')).toBeNull()
    expect(planLinkMove(tiles, 'd', 'up')).toBeNull()
  })

  it('does nothing for a link it does not know', () => {
    expect(planLinkMove(tiles, 'zzz', 'up')).toBeNull()
  })
})

describe('applyLinkOrder', () => {
  it('reorders one group in place and leaves the others where they are', () => {
    const tiles = [link('a', 'c1', 'a0'), link('b', 'c1', 'a1'), link('d', 'c2', 'a0')]
    const plan = planLinkMove(tiles, 'b', 'up')
    if (plan === null) throw new Error('expected a plan')

    const next = applyLinkOrder(tiles, plan)

    expect(next.map((tile) => tile.id)).toEqual(['b', 'a', 'd'])
    expect(next[0]?.sortKey).toBe(plan.items[0]?.sortKey)
    expect(tiles.map((tile) => tile.id)).toEqual(['a', 'b', 'd'])
  })
})

describe('the text form', () => {
  const tile = link('a', 'c1', 'a0', {
    texts: [
      { locale: 'en', label: 'Menu', line: 'Lunch and dinner', provenance: null },
      { locale: 'bg', label: 'Меню', line: null, provenance: null },
    ],
  })

  it('starts with one entry per offered language, empty where nothing is saved', () => {
    expect(textsFormValues(tile, ['en', 'bg'])).toEqual({
      texts: [
        { locale: 'en', label: 'Menu', line: 'Lunch and dinner' },
        { locale: 'bg', label: 'Меню', line: '' },
      ],
    })
    expect(textsFormValues(link('b', 'c1', 'a1', { texts: [] }), ['en', 'bg'])).toEqual({
      texts: [
        { locale: 'en', label: '', line: '' },
        { locale: 'bg', label: '', line: '' },
      ],
    })
  })

  it('requires the primary language and every language that already has a text', () => {
    expect(requiredTextLocales(tile, 'en')).toEqual(['en', 'bg'])
    expect(requiredTextLocales(link('b', 'c1', 'a1', { texts: [] }), 'en')).toEqual([
      'en',
    ])
  })

  it('sends only the languages with a label, a blank line as null', () => {
    expect(
      toLinkTextsInput('a', {
        texts: [
          { locale: 'en', label: 'Menu', line: '' },
          { locale: 'bg', label: 'Меню', line: ' Обяд ' },
        ],
      }),
    ).toEqual({
      linkId: 'a',
      texts: [
        { locale: 'en', label: 'Menu', line: null },
        { locale: 'bg', label: 'Меню', line: 'Обяд' },
      ],
    })
    expect(
      toLinkTextsInput('a', {
        texts: [
          { locale: 'en', label: 'Menu', line: '' },
          { locale: 'bg', label: '', line: 'left over' },
        ],
      }).texts.map((text) => text.locale),
    ).toEqual(['en'])
  })
})

describe('the title form', () => {
  it('starts with the written titles and empty for a language on the default', () => {
    expect(titlesFormValues({ en: 'Around the resort' }, ['en', 'bg'])).toEqual({
      titles: [
        { locale: 'en', title: 'Around the resort' },
        { locale: 'bg', title: '' },
      ],
    })
  })

  it('sends an empty title as null, which resets the language to the default', () => {
    expect(
      toLinktreeTitlesInput('p1', {
        titles: [
          { locale: 'en', title: ' Around the resort ' },
          { locale: 'bg', title: '  ' },
        ],
      }),
    ).toEqual({
      portalId: 'p1',
      titles: [
        { locale: 'en', title: 'Around the resort' },
        { locale: 'bg', title: null },
      ],
    })
  })
})

describe('describeUnsavedLine', () => {
  it('warns when a line is typed for a language that has no label', () => {
    expect(describeUnsavedLine({ label: '', line: 'Lunch' })).toBe(
      'Add a label first: a line is only saved together with its label.',
    )
    expect(describeUnsavedLine({ label: '  ', line: ' Lunch ' })).not.toBeNull()
  })

  it('says nothing when the label is there or there is no line', () => {
    expect(describeUnsavedLine({ label: 'Menu', line: 'Lunch' })).toBeNull()
    expect(describeUnsavedLine({ label: '', line: '' })).toBeNull()
    expect(describeUnsavedLine({ label: '', line: '   ' })).toBeNull()
  })
})

describe('isAddressWrite', () => {
  it('is true for a write that sends the address', () => {
    expect(isAddressWrite({ linkId: 'l-1', url: 'https://avela.bg/menu' })).toBe(true)
  })

  it('is false for an icon or a photo, whose refusal is not about the address', () => {
    expect(isAddressWrite({ linkId: 'l-1', iconKey: 'wifi' })).toBe(false)
    expect(isAddressWrite({ linkId: 'l-1', imageAssetId: 'a-1' })).toBe(false)
    expect(isAddressWrite({ linkId: 'l-1', imageAssetId: null })).toBe(false)
  })
})
