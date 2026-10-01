import { describe, expect, it } from 'vitest'
import {
  LINKTREE_TITLE_MAX_LENGTH,
  LINK_TEXT_LABEL_MAX_LENGTH,
  LINK_TEXT_LINE_MAX_LENGTH,
  MAX_PORTAL_LINKS,
  hasRoomForAnotherLink,
  linktreeDefaultTitle,
  STARTED_CATEGORY_TITLE,
  resolveLinkTexts,
  validateLinkTextInput,
  validateLinktreeTitle,
  type StoredPortalLinkText,
} from './portal-linktree'

const AT = new Date('2026-10-01T10:00:00Z')

const stored = (
  linkId: string,
  locale: StoredPortalLinkText['locale'],
  label: string,
  overrides: Partial<StoredPortalLinkText> = {},
): StoredPortalLinkText => ({
  linkId,
  locale,
  label,
  line: null,
  provenance: null,
  version: 1,
  updatedBy: 'user-1',
  updatedAt: AT,
  ...overrides,
})

describe('Linktree constants', () => {
  it('caps a Portal at four links', () => {
    expect(MAX_PORTAL_LINKS).toBe(4)
  })

  it('keeps every writer limit inside the published-snapshot reader limits', () => {
    expect(LINK_TEXT_LABEL_MAX_LENGTH).toBeLessThanOrEqual(100)
    expect(LINK_TEXT_LINE_MAX_LENGTH).toBeLessThanOrEqual(300)
    expect(LINKTREE_TITLE_MAX_LENGTH).toBeLessThanOrEqual(120)
  })
})

describe('hasRoomForAnotherLink', () => {
  it.each([
    [0, true],
    [3, true],
    [4, false],
    [7, false],
  ])('with %i links room is %s', (count, room) => {
    expect(hasRoomForAnotherLink(count)).toBe(room)
  })
})

describe('validateLinkTextInput', () => {
  it('trims the label and treats a blank line as no line', () => {
    const result = validateLinkTextInput({ locale: 'en', label: '  Menu  ', line: '  ' })
    expect(result.isOk() && result.value).toEqual({
      locale: 'en',
      label: 'Menu',
      line: null,
      provenance: null,
    })
  })

  it('keeps a trimmed line and an AI provenance', () => {
    const result = validateLinkTextInput({
      locale: 'bg',
      label: 'Меню',
      line: ' Вечеря до 22:00 ',
      provenance: 'ai_draft',
    })
    expect(result.isOk() && result.value).toEqual({
      locale: 'bg',
      label: 'Меню',
      line: 'Вечеря до 22:00',
      provenance: 'ai_draft',
    })
  })

  it('refuses an empty or over-long label', () => {
    for (const label of ['', '   ', 'x'.repeat(LINK_TEXT_LABEL_MAX_LENGTH + 1)]) {
      const result = validateLinkTextInput({ locale: 'en', label })
      expect(result.isErr() && result.error.code).toBe('invalid_label')
    }
  })

  it('refuses an over-long line', () => {
    const result = validateLinkTextInput({
      locale: 'en',
      label: 'Menu',
      line: 'x'.repeat(LINK_TEXT_LINE_MAX_LENGTH + 1),
    })
    expect(result.isErr() && result.error.code).toBe('invalid_label')
  })
})

describe('validateLinktreeTitle', () => {
  it('trims a title and treats null or blank as the default', () => {
    const titled = validateLinktreeTitle('  Around town ')
    expect(titled.isOk() && titled.value).toBe('Around town')
    for (const value of [null, '', '   ']) {
      const reset = validateLinktreeTitle(value)
      expect(reset.isOk() && reset.value).toBeNull()
    }
  })

  it('refuses a title over the limit', () => {
    const result = validateLinktreeTitle('x'.repeat(LINKTREE_TITLE_MAX_LENGTH + 1))
    expect(result.isErr() && result.error.code).toBe('invalid_title')
  })
})

describe('resolveLinkTexts', () => {
  const links = [
    { id: 'link-1', label: 'Legacy menu' },
    { id: 'link-2', label: 'Legacy spa' },
  ]

  it('returns stored rows as they are', () => {
    const rows = [stored('link-1', 'en', 'Menu'), stored('link-2', 'en', 'Spa')]
    const resolved = resolveLinkTexts({ links, texts: rows, primaryLocale: 'en' })
    expect(resolved.map((text) => [text.linkId, text.label, text.source])).toEqual([
      ['link-1', 'Menu', 'text'],
      ['link-2', 'Spa', 'text'],
    ])
  })

  it('falls back to the legacy label in the primary locale when its text row is missing', () => {
    const rows = [stored('link-1', 'en', 'Menu')]
    const resolved = resolveLinkTexts({ links, texts: rows, primaryLocale: 'en' })
    const fallback = resolved.find((text) => text.linkId === 'link-2')
    expect(fallback).toMatchObject({
      locale: 'en',
      label: 'Legacy spa',
      line: null,
      provenance: null,
      version: 0,
      source: 'legacy_label',
    })
  })

  describe('a link renamed after its primary text was written', () => {
    const LATER = new Date(AT.getTime() + 60_000)
    const renamed = [{ id: 'link-1', label: 'Renamed by old code', updatedAt: LATER }]

    it('reads the link label, which is the later write, and keeps the line', () => {
      const rows = [
        stored('link-1', 'en', 'Menu', { line: 'Until 11', provenance: 'ai_draft' }),
      ]
      const [resolved] = resolveLinkTexts({
        links: renamed,
        texts: rows,
        primaryLocale: 'en',
      })

      expect(resolved).toMatchObject({
        label: 'Renamed by old code',
        line: 'Until 11',
        provenance: null,
        source: 'legacy_label',
      })
    })

    it('leaves a text written after the rename alone', () => {
      const rows = [
        stored('link-1', 'en', 'Menu', { updatedAt: new Date(LATER.getTime() + 1) }),
      ]
      const [resolved] = resolveLinkTexts({
        links: renamed,
        texts: rows,
        primaryLocale: 'en',
      })

      expect(resolved).toMatchObject({ label: 'Menu', source: 'text' })
    })

    it('leaves a link whose label already equals its text alone', () => {
      const rows = [stored('link-1', 'en', 'Menu')]
      const same = [{ id: 'link-1', label: 'Menu', updatedAt: LATER }]
      const [resolved] = resolveLinkTexts({
        links: same,
        texts: rows,
        primaryLocale: 'en',
      })

      expect(resolved).toMatchObject({ label: 'Menu', source: 'text' })
    })

    it('never rewrites another language from the link label', () => {
      const rows = [stored('link-1', 'bg', 'Меню')]
      const resolved = resolveLinkTexts({
        links: renamed,
        texts: rows,
        primaryLocale: 'en',
      })

      expect(resolved.find((text) => text.locale === 'bg')).toMatchObject({
        label: 'Меню',
        source: 'text',
      })
    })

    it('does nothing for a caller that does not know when the link was written', () => {
      const rows = [stored('link-1', 'en', 'Menu')]
      const [resolved] = resolveLinkTexts({
        links: [{ id: 'link-1', label: 'Renamed by old code' }],
        texts: rows,
        primaryLocale: 'en',
      })

      expect(resolved).toMatchObject({ label: 'Menu', source: 'text' })
    })
  })

  it('never invents a text for a non-primary locale', () => {
    const rows = [stored('link-1', 'bg', 'Меню')]
    const resolved = resolveLinkTexts({ links, texts: rows, primaryLocale: 'en' })
    expect(resolved.filter((text) => text.locale === 'bg')).toHaveLength(1)
    expect(
      resolved.filter((text) => text.source === 'legacy_label').map((t) => t.linkId),
    ).toEqual(['link-1', 'link-2'])
  })

  it('ignores a stored row for a link that no longer exists', () => {
    const rows = [stored('gone', 'en', 'Orphan')]
    const resolved = resolveLinkTexts({ links, texts: rows, primaryLocale: 'en' })
    expect(resolved.map((text) => text.linkId)).toEqual(['link-1', 'link-2'])
  })

  it('orders by link order, then locale order with the primary locale first', () => {
    const rows = [
      stored('link-2', 'bg', 'Спа'),
      stored('link-1', 'bg', 'Меню'),
      stored('link-1', 'en', 'Menu'),
      stored('link-2', 'en', 'Spa'),
    ]
    const resolved = resolveLinkTexts({ links, texts: rows, primaryLocale: 'bg' })
    expect(resolved.map((text) => `${text.linkId}:${text.locale}`)).toEqual([
      'link-1:bg',
      'link-1:en',
      'link-2:bg',
      'link-2:en',
    ])
  })
})

describe('linktreeDefaultTitle', () => {
  it('words the default in the languages that have a reviewed pack', () => {
    expect(linktreeDefaultTitle('en')).toBe('Useful links')
    expect(linktreeDefaultTitle('bg')).toBe('Полезни връзки')
  })

  it('falls back to English for a language with no pack yet', () => {
    expect(linktreeDefaultTitle('de')).toBe('Useful links')
  })
})

describe('STARTED_CATEGORY_TITLE', () => {
  it('is a fixed neutral name, because no guest reads a category any more', () => {
    expect(STARTED_CATEGORY_TITLE).toBe('Links')
  })
})
