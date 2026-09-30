import { describe, expect, it } from 'vitest'
import {
  addableLanguages,
  applyLanguageChange,
  describeCoverage,
  describeFallbackEffect,
  describeMissingText,
  hasLaterLanguages,
  languageDisplayName,
  missingTextSection,
  summarizeLanguageCoverage,
} from './portal-languages-rules'
import type { PortalLanguageCoverageRow } from '#/contexts/portal/application/public-api'

const row = (
  overrides: Partial<PortalLanguageCoverageRow> = {},
): PortalLanguageCoverageRow => ({
  locale: 'bg',
  isFallback: false,
  total: 4,
  present: 4,
  missing: [],
  ...overrides,
})

describe('addableLanguages', () => {
  it('offers every launch language with a v2 pack that the portal does not have yet', () => {
    expect(addableLanguages({ primary: 'en', additional: [] })).toEqual(['bg'])
    expect(addableLanguages({ primary: 'bg', additional: [] })).toEqual(['en'])
  })

  it('offers nothing once every launch language is on the portal', () => {
    expect(addableLanguages({ primary: 'en', additional: ['bg'] })).toEqual([])
  })

  it('does not offer a catalogue language whose pack has not shipped', () => {
    const offered = addableLanguages({ primary: 'en', additional: [] })
    expect(offered).not.toContain('es')
    expect(offered).not.toContain('de')
  })
})

describe('hasLaterLanguages', () => {
  it('is true while the catalogue holds languages that cannot be added yet', () => {
    expect(hasLaterLanguages()).toBe(true)
  })
})

describe('applyLanguageChange', () => {
  const set = { primary: 'en', additional: ['bg'] } as const

  it('adds a language after the ones already offered', () => {
    expect(
      applyLanguageChange(
        { primary: 'bg', additional: [] },
        { kind: 'add', locale: 'en' },
      ),
    ).toEqual({ primary: 'bg', additional: ['en'] })
  })

  it('refuses to add a language twice, or one that cannot be added', () => {
    expect(applyLanguageChange(set, { kind: 'add', locale: 'bg' })).toBeNull()
    expect(applyLanguageChange(set, { kind: 'add', locale: 'de' })).toBeNull()
  })

  it('removes an additional language', () => {
    expect(applyLanguageChange(set, { kind: 'remove', locale: 'bg' })).toEqual({
      primary: 'en',
      additional: [],
    })
  })

  it('never removes the fallback language, nor a language that is not there', () => {
    expect(applyLanguageChange(set, { kind: 'remove', locale: 'en' })).toBeNull()
    expect(applyLanguageChange(set, { kind: 'remove', locale: 'de' })).toBeNull()
  })

  it('makes another language the fallback and keeps the old one as an additional language', () => {
    expect(applyLanguageChange(set, { kind: 'make_fallback', locale: 'bg' })).toEqual({
      primary: 'bg',
      additional: ['en'],
    })
  })

  it('refuses to make the fallback language the fallback again, or one that is not offered', () => {
    expect(applyLanguageChange(set, { kind: 'make_fallback', locale: 'en' })).toBeNull()
    expect(applyLanguageChange(set, { kind: 'make_fallback', locale: 'fr' })).toBeNull()
  })

  it('returns a new set and leaves the old one alone', () => {
    const before = { primary: 'en', additional: ['bg'] } as const
    applyLanguageChange(before, { kind: 'remove', locale: 'bg' })
    expect(before).toEqual({ primary: 'en', additional: ['bg'] })
  })
})

describe('languageDisplayName', () => {
  it('gives the name a person reads it by and the English name', () => {
    expect(languageDisplayName('bg')).toEqual({
      native: 'Български',
      english: 'Bulgarian',
      chip: 'БГ',
    })
  })
})

describe('describeCoverage', () => {
  it('says all of the texts are there when none is missing', () => {
    expect(describeCoverage(row({ total: 14, present: 14 }))).toEqual({
      tone: 'complete',
      text: 'All 14 texts',
    })
  })

  it('counts what is written and what is missing', () => {
    expect(
      describeCoverage(
        row({
          total: 14,
          present: 13,
          missing: [{ key: 'title', kind: 'title', linkId: null, linkLabel: null }],
        }),
      ),
    ).toEqual({ tone: 'missing', text: '13 of 14 · 1 missing' })
  })

  it('uses the singular for a language with one text', () => {
    expect(describeCoverage(row({ total: 1, present: 1 }))).toEqual({
      tone: 'complete',
      text: 'All 1 text',
    })
  })
})

describe('describeMissingText and missingTextSection', () => {
  it('names a title, a description and a link label, and where each is written', () => {
    const title = { key: 'title', kind: 'title', linkId: null, linkLabel: null } as const
    const description = {
      key: 'description',
      kind: 'description',
      linkId: null,
      linkLabel: null,
    } as const
    const label = {
      key: 'link:l-1',
      kind: 'link_label',
      linkId: 'l-1',
      linkLabel: 'Book a table',
    } as const
    expect(describeMissingText(title)).toBe('Title')
    expect(describeMissingText(description)).toBe('Description')
    expect(describeMissingText(label)).toBe('Label for “Book a table”')
    expect(missingTextSection(title)).toBe('welcome')
    expect(missingTextSection(description)).toBe('welcome')
    expect(missingTextSection(label)).toBe('linktree')
  })
})

describe('describeFallbackEffect', () => {
  it('says what guests of a language see in place of a missing text', () => {
    expect(
      describeFallbackEffect(
        row({
          locale: 'bg',
          missing: [
            { key: 'link:l-1', kind: 'link_label', linkId: 'l-1', linkLabel: 'Menu' },
          ],
        }),
        'en',
      ),
    ).toBe('Bulgarian guests see 1 text in English')
  })

  it('is null for the fallback language itself and for a language with nothing missing', () => {
    expect(
      describeFallbackEffect(row({ isFallback: true, locale: 'en' }), 'en'),
    ).toBeNull()
    expect(describeFallbackEffect(row(), 'en')).toBeNull()
  })

  it('pluralises', () => {
    const missing = [
      { key: 'title', kind: 'title', linkId: null, linkLabel: null },
      { key: 'description', kind: 'description', linkId: null, linkLabel: null },
    ] as const
    expect(describeFallbackEffect(row({ missing }), 'en')).toBe(
      'Bulgarian guests see 2 texts in English',
    )
  })
})

describe('summarizeLanguageCoverage', () => {
  it('counts languages and gaps for the section list', () => {
    expect(summarizeLanguageCoverage({ languageCount: 4, missingTotal: 1 })).toEqual({
      text: '4 languages',
      attention: '1 missing',
    })
    expect(summarizeLanguageCoverage({ languageCount: 1, missingTotal: 0 })).toEqual({
      text: '1 language',
      attention: null,
    })
  })
})
