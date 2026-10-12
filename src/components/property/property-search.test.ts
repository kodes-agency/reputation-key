// One matcher for every client-side list search. Two lists that fold text
// differently disagree about what "cafe" finds; this is the definition they
// share.
import { describe, expect, it } from 'vitest'
import {
  foldSearchText,
  matchesPropertySearch,
  matchesSearchText,
} from './property-search'

describe('foldSearchText', () => {
  it('ignores case', () => {
    expect(foldSearchText('Rila GRAND')).toBe('rila grand')
  })

  it('ignores accents', () => {
    expect(foldSearchText('Café Plaza')).toBe('cafe plaza')
    expect(foldSearchText('Zürich')).toBe('zurich')
  })

  it('folds Bulgarian by case and keeps the letters', () => {
    expect(foldSearchText('СТАРА')).toBe('стара')
  })

  it('folds compatibility forms, so full-width and ligature text still matches', () => {
    expect(foldSearchText('ＣＡＦＥ')).toBe('cafe')
    expect(foldSearchText('ﬁsh')).toBe('fish')
  })
})

describe('matchesSearchText', () => {
  it('matches part of the text', () => {
    expect(matchesSearchText('Rila Grand Hotel', 'grand')).toBe(true)
  })

  it('finds an accented name from the plain query, and the reverse', () => {
    expect(matchesSearchText('Café Plaza', 'cafe')).toBe(true)
    expect(matchesSearchText('Cafe Plaza', 'café')).toBe(true)
  })

  it('finds a Bulgarian name regardless of case', () => {
    expect(matchesSearchText('Стара Планина', 'СТАРА')).toBe(true)
  })

  it('treats an empty or blank query as matching everything', () => {
    expect(matchesSearchText('Anything', '')).toBe(true)
    expect(matchesSearchText('Anything', '   ')).toBe(true)
  })

  it('does not match letters that are not there in order together', () => {
    // Deliberately not fuzzy: a scorer would find nearly everything for any word.
    expect(matchesSearchText('Rila Grand Hotel', 'rgh')).toBe(false)
  })
})

describe('matchesPropertySearch', () => {
  it('is the same matcher applied to a property name', () => {
    expect(matchesPropertySearch('Café Plaza', 'cafe')).toBe(true)
    expect(matchesPropertySearch('Café Plaza', 'zzz')).toBe(false)
  })
})
