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
  const links = [{ id: 'link-1' }, { id: 'link-2' }]

  it('returns stored rows as they are', () => {
    const rows = [stored('link-1', 'en', 'Menu'), stored('link-2', 'en', 'Spa')]
    const resolved = resolveLinkTexts({ links, texts: rows, primaryLocale: 'en' })
    expect(resolved.map((text) => [text.linkId, text.label])).toEqual([
      ['link-1', 'Menu'],
      ['link-2', 'Spa'],
    ])
  })

  it('reads the stored primary text with its line and provenance', () => {
    const rows = [
      stored('link-1', 'en', 'Menu', { line: 'Until 11', provenance: 'ai_draft' }),
    ]
    const [resolved] = resolveLinkTexts({
      links: [{ id: 'link-1' }],
      texts: rows,
      primaryLocale: 'en',
    })

    expect(resolved).toMatchObject({
      label: 'Menu',
      line: 'Until 11',
      provenance: 'ai_draft',
    })
  })

  it('never invents a text for a link or a locale that has none', () => {
    const rows = [stored('link-1', 'bg', 'Меню')]
    const resolved = resolveLinkTexts({ links, texts: rows, primaryLocale: 'en' })
    expect(resolved.map((text) => `${text.linkId}:${text.locale}`)).toEqual(['link-1:bg'])
  })

  it('ignores a stored row for a link that no longer exists', () => {
    const rows = [stored('gone', 'en', 'Orphan'), stored('link-1', 'en', 'Menu')]
    const resolved = resolveLinkTexts({ links, texts: rows, primaryLocale: 'en' })
    expect(resolved.map((text) => text.linkId)).toEqual(['link-1'])
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
  it('words the default in every guest language', () => {
    expect(linktreeDefaultTitle('en')).toBe('Useful links')
    expect(linktreeDefaultTitle('bg')).toBe('Полезни връзки')
    expect(linktreeDefaultTitle('es')).toBe('Enlaces útiles')
    expect(linktreeDefaultTitle('it')).toBe('Link utili')
    expect(linktreeDefaultTitle('fr')).toBe('Liens utiles')
    expect(linktreeDefaultTitle('de')).toBe('Nützliche Links')
  })
})

describe('STARTED_CATEGORY_TITLE', () => {
  it('is a fixed neutral name, because no guest reads a category any more', () => {
    expect(STARTED_CATEGORY_TITLE).toBe('Links')
  })
})
