import { describe, expect, it } from 'vitest'
import { parseCanonicalReplyLanguageTag } from './reply-language-catalogue'
import {
  FALLBACK_REPLY_LANGUAGE,
  mappedReplyLanguageCountries,
  suggestedReplyLanguageForCountry,
} from './country-reply-language'
import { isIsoCountryCode } from './domain/iso-country-codes'

describe('suggested reply language for a country', () => {
  it('suggests the country language when it is a reply language', () => {
    expect(suggestedReplyLanguageForCountry('DE')).toBe('de-Latn')
    expect(suggestedReplyLanguageForCountry('BR')).toBe('pt-Latn')
    expect(suggestedReplyLanguageForCountry('JP')).toBe('ja-Jpan')
    expect(suggestedReplyLanguageForCountry('TW')).toBe('zh-Hant')
    expect(suggestedReplyLanguageForCountry('BG')).toBe('bg-Cyrl')
  })

  it('falls back to English for other countries and for a missing country', () => {
    expect(suggestedReplyLanguageForCountry('GR')).toBe(FALLBACK_REPLY_LANGUAGE)
    expect(suggestedReplyLanguageForCountry('US')).toBe('en-Latn')
    expect(suggestedReplyLanguageForCountry(null)).toBe('en-Latn')
    expect(suggestedReplyLanguageForCountry(undefined)).toBe('en-Latn')
    expect(suggestedReplyLanguageForCountry('')).toBe('en-Latn')
  })

  it('reads a country code regardless of case and padding', () => {
    expect(suggestedReplyLanguageForCountry(' fr ')).toBe('fr-Latn')
  })

  it('maps only real countries, each once, to canonical reply languages', () => {
    const countries = mappedReplyLanguageCountries()
    expect(new Set(countries).size).toBe(countries.length)
    for (const country of countries) {
      expect(isIsoCountryCode(country)).toBe(true)
      expect(
        parseCanonicalReplyLanguageTag(suggestedReplyLanguageForCountry(country)),
      ).not.toBeNull()
    }
  })
})
