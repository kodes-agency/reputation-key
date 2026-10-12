import { describe, expect, it } from 'vitest'
import {
  addableLanguages,
  applyLanguageChange,
  describeCoverage,
  describeFallbackEffect,
  describeMissingText,
  englishNameBeside,
  hasLaterLanguages,
  languageDisplayName,
  languageSubline,
  missingTextSection,
  type LanguageRegistry,
} from './portal-languages-rules'
import type {
  MissingPortalText,
  PortalLanguageCoverageRow,
} from '#/contexts/portal/application/public-api'

// A fixture registry, so the rules are pinned whatever packs the live registry
// has shipped: en and bg are offered with a generation 2 pack, es is offered but
// its pack has not shipped, and de and it are not offered at all.
const registry: LanguageRegistry = {
  locales: ['en', 'es', 'it', 'fr', 'de', 'bg'],
  isOffered: (locale) => locale === 'en' || locale === 'bg' || locale === 'es',
  hasGuestCopyPack: (locale) => locale === 'en' || locale === 'bg',
}
const everythingShipped: LanguageRegistry = {
  locales: ['en', 'bg'],
  isOffered: () => true,
  hasGuestCopyPack: () => true,
}

// A gap blocks publishing only in the primary language, so the fixtures take it.
const titleGap = (blocksPublish = false): MissingPortalText => ({
  key: 'title',
  kind: 'title',
  linkId: null,
  linkLabel: null,
  blocksPublish,
})
const descriptionGap = (blocksPublish = false): MissingPortalText => ({
  key: 'description',
  kind: 'description',
  linkId: null,
  linkLabel: null,
  blocksPublish,
})
const labelGap = (
  linkId: string,
  linkLabel: string | null,
  blocksPublish = false,
): MissingPortalText => ({
  key: `link:${linkId}`,
  kind: 'link_label',
  linkId,
  linkLabel,
  blocksPublish,
})

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
    expect(addableLanguages({ primary: 'en', additional: [] }, registry)).toEqual(['bg'])
    expect(addableLanguages({ primary: 'bg', additional: [] }, registry)).toEqual(['en'])
  })

  it('offers nothing once every launch language is on the portal', () => {
    expect(addableLanguages({ primary: 'en', additional: ['bg'] }, registry)).toEqual([])
  })

  it('does not offer a language whose pack has not shipped, nor one that is not offered', () => {
    const offered = addableLanguages({ primary: 'en', additional: [] }, registry)
    expect(offered).not.toContain('es')
    expect(offered).not.toContain('de')
  })

  it('offers a language as soon as its pack ships', () => {
    const shipped: LanguageRegistry = { ...registry, hasGuestCopyPack: () => true }
    expect(addableLanguages({ primary: 'en', additional: [] }, shipped)).toEqual([
      'es',
      'bg',
    ])
  })

  it('reads the live registry when none is given: all six languages, in catalogue order', () => {
    expect(addableLanguages({ primary: 'en', additional: [] })).toEqual([
      'es',
      'it',
      'fr',
      'de',
      'bg',
    ])
    expect(addableLanguages({ primary: 'de', additional: ['en'] })).toEqual([
      'es',
      'it',
      'fr',
      'bg',
    ])
  })
})

describe('hasLaterLanguages', () => {
  it('is true while the catalogue holds languages that cannot be added yet', () => {
    expect(hasLaterLanguages(registry)).toBe(true)
  })

  it('is false once every language in the catalogue can be added', () => {
    expect(hasLaterLanguages(everythingShipped)).toBe(false)
  })

  it('is false on the live registry, which offers every catalogue language with a pack', () => {
    expect(hasLaterLanguages()).toBe(false)
  })

  it('is true for a language that is offered but has no pack yet', () => {
    const noPack: LanguageRegistry = {
      ...everythingShipped,
      hasGuestCopyPack: (l) => l === 'en',
    }
    expect(hasLaterLanguages(noPack)).toBe(true)
  })
})

describe('applyLanguageChange', () => {
  const set = { primary: 'en', additional: ['bg'] } as const
  const apply = (
    current: Parameters<typeof applyLanguageChange>[0],
    change: Parameters<typeof applyLanguageChange>[1],
  ) => applyLanguageChange(current, change, registry)

  it('adds a language after the ones already offered', () => {
    expect(
      apply({ primary: 'bg', additional: [] }, { kind: 'add', locale: 'en' }),
    ).toEqual({ primary: 'bg', additional: ['en'] })
  })

  it('refuses to add a language twice, or one that cannot be added', () => {
    expect(apply(set, { kind: 'add', locale: 'bg' })).toBeNull()
    expect(apply(set, { kind: 'add', locale: 'de' })).toBeNull()
  })

  it('removes an additional language', () => {
    expect(apply(set, { kind: 'remove', locale: 'bg' })).toEqual({
      primary: 'en',
      additional: [],
    })
  })

  it('never removes the fallback language, nor a language that is not there', () => {
    expect(apply(set, { kind: 'remove', locale: 'en' })).toBeNull()
    expect(apply(set, { kind: 'remove', locale: 'de' })).toBeNull()
  })

  it('makes another language the fallback and keeps the old one as an additional language', () => {
    expect(apply(set, { kind: 'make_fallback', locale: 'bg' })).toEqual({
      primary: 'bg',
      additional: ['en'],
    })
  })

  it('refuses to make the fallback language the fallback again, or one that is not offered', () => {
    expect(apply(set, { kind: 'make_fallback', locale: 'en' })).toBeNull()
    expect(apply(set, { kind: 'make_fallback', locale: 'fr' })).toBeNull()
  })

  it('returns a new set and leaves the old one alone', () => {
    const before = { primary: 'en', additional: ['bg'] } as const
    apply(before, { kind: 'remove', locale: 'bg' })
    expect(before).toEqual({ primary: 'en', additional: ['bg'] })
  })
})

describe('languageDisplayName', () => {
  it('gives the name a person reads it by and the English name', () => {
    expect(languageDisplayName('bg')).toEqual({
      native: 'Български',
      english: 'Bulgarian',
      chip: 'BG',
    })
  })
})

describe('englishNameBeside', () => {
  it('gives the English name beside a language read by another name', () => {
    expect(englishNameBeside('bg')).toBe('Bulgarian')
  })

  it('gives nothing for English, whose own name is already English', () => {
    expect(englishNameBeside('en')).toBeNull()
  })
})

describe('languageSubline', () => {
  it('says what the fallback language does', () => {
    expect(languageSubline('en', true)).toBe('Used when a text is missing')
    expect(languageSubline('bg', true)).toBe('Used when a text is missing')
  })

  it('gives another language its English name, and English none', () => {
    expect(languageSubline('de', false)).toBe('German')
    expect(languageSubline('en', false)).toBeNull()
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
      describeCoverage(row({ total: 14, present: 13, missing: [titleGap()] })),
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
    const label = labelGap('l-1', 'Book a table')
    expect(describeMissingText(titleGap())).toBe('Welcome line')
    expect(describeMissingText(descriptionGap())).toBe('Link preview')
    expect(describeMissingText(label)).toBe('Label for “Book a table”')
    expect(missingTextSection(titleGap())).toBe('welcome')
    expect(missingTextSection(descriptionGap())).toBe('welcome')
    expect(missingTextSection(label)).toBe('linktree')
  })
})

describe('describeFallbackEffect', () => {
  it('says a missing link label is shown in the fallback language', () => {
    expect(
      describeFallbackEffect(row({ missing: [labelGap('l-1', 'Menu')] }), 'en'),
    ).toBe('Bulgarian guests see 1 link label in English')
  })

  it('says a missing title or description in another language is read in the fallback language', () => {
    expect(describeFallbackEffect(row({ missing: [titleGap()] }), 'en')).toBe(
      'Bulgarian guests see the welcome line in English',
    )
    expect(
      describeFallbackEffect(row({ missing: [titleGap(), descriptionGap()] }), 'en'),
    ).toBe('Bulgarian guests see the welcome line and the link preview in English')
  })

  it('lists every kind of gap in one sentence', () => {
    expect(
      describeFallbackEffect(
        row({
          missing: [
            titleGap(),
            descriptionGap(),
            labelGap('l-1', 'Menu'),
            labelGap('l-2', 'Spa'),
          ],
        }),
        'en',
      ),
    ).toBe(
      'Bulgarian guests see the welcome line, the link preview and 2 link labels in English',
    )
  })

  it('never says another language stops the Portal being published', () => {
    const effect = describeFallbackEffect(
      row({ missing: [titleGap(), descriptionGap(), labelGap('l-1', 'Menu')] }),
      'en',
    )
    expect(effect).not.toMatch(/publish/i)
  })

  it('is null for a language with nothing missing', () => {
    expect(describeFallbackEffect(row(), 'en')).toBeNull()
    expect(
      describeFallbackEffect(row({ isFallback: true, locale: 'en' }), 'en'),
    ).toBeNull()
  })

  it('says a gap in the fallback language itself stops publishing, since there is nothing to fall back to', () => {
    const fallback = { isFallback: true, locale: 'en' } as const
    expect(
      describeFallbackEffect(row({ ...fallback, missing: [titleGap(true)] }), 'en'),
    ).toBe('English is missing 1 text that publishing needs')
    expect(
      describeFallbackEffect(
        row({
          ...fallback,
          missing: [titleGap(true), labelGap('l-1', 'Menu', true)],
        }),
        'en',
      ),
    ).toBe('English is missing 2 texts that publishing needs')
  })
})
