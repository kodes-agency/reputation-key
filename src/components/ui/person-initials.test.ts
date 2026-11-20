import { describe, expect, it } from 'vitest'
import { personInitials } from './person-initials'

describe('personInitials', () => {
  it('takes the first letter of the first two words, uppercased', () => {
    expect(personInitials('Georgi Ivanov')).toBe('GI')
    expect(personInitials('maria petrova')).toBe('MP')
  })

  it('reads Cyrillic names by letter, not by byte', () => {
    expect(personInitials('Пламен Аврамов')).toBe('ПА')
    expect(personInitials('пламен аврамов')).toBe('ПА')
  })

  it('stops at two words, so a middle name does not widen the disc', () => {
    expect(personInitials('Maria Georgieva Petrova')).toBe('MG')
  })

  it('returns one letter for a single-word name', () => {
    expect(personInitials('Georgi')).toBe('G')
    expect(personInitials('山田太郎')).toBe('山')
  })

  it('ignores leading, trailing and repeated whitespace of any kind', () => {
    expect(personInitials('  Georgi Ivanov')).toBe('GI')
    expect(personInitials('Georgi   Ivanov  ')).toBe('GI')
    expect(personInitials('Georgi\tIvanov')).toBe('GI')
    // U+00A0 NO-BREAK SPACE, which a name pasted from a document can carry.
    expect(personInitials('Georgi Ivanov')).toBe('GI')
  })

  it('keeps a decomposed accented letter whole instead of splitting its mark off', () => {
    // "É" as E + U+0301 COMBINING ACUTE ACCENT: two code points, one grapheme.
    expect(personInitials('Élodie Martin')).toBe('ÉM')
  })

  it('keeps an astral-plane letter whole instead of emitting half a surrogate pair', () => {
    // U+1D49C MATHEMATICAL SCRIPT CAPITAL A is two UTF-16 code units.
    const initials = personInitials('\u{1D49C}lex Ivanov')
    expect(initials).toBe('\u{1D49C}I')
    // With the `u` flag a paired surrogate is one code point, so `\p{Cs}`
    // matches only a LONE surrogate — the corruption `name[0]` would produce.
    expect(/\p{Cs}/u.test(initials ?? '')).toBe(false)
  })

  it('skips punctuation to the first letter or digit of a word', () => {
    expect(personInitials('Maria (Front desk)')).toBe('MF')
    expect(personInitials('"Georgi" Ivanov')).toBe('GI')
  })

  it('skips a word that holds no letter or digit at all', () => {
    expect(personInitials('Georgi – Reception')).toBe('GR')
    expect(personInitials('— Georgi')).toBe('G')
  })

  it('returns null when there is nothing to draw, so the caller falls back to a glyph', () => {
    expect(personInitials(null)).toBeNull()
    expect(personInitials(undefined)).toBeNull()
    expect(personInitials('')).toBeNull()
    expect(personInitials('   ')).toBeNull()
    expect(personInitials('— ·')).toBeNull()
  })
})
