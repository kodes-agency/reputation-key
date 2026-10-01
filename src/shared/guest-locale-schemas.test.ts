import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES, GUEST_LANGUAGE_PACKS } from './domain/guest-locale'
import {
  additionalGuestLocalesSchema,
  GUEST_LANGUAGE_PACK_SQL_PATTERN,
  GUEST_LOCALE_JSONB_LITERAL,
  GUEST_LOCALE_SQL_LIST,
  guestLocaleSchema,
  offeredGuestLocaleSchema,
} from './guest-locale-schemas'

describe('guest locale schemas', () => {
  it('reads every catalogue locale, and lets managers offer every one of them', () => {
    for (const locale of GUEST_LOCALES) {
      expect(guestLocaleSchema.safeParse(locale).success).toBe(true)
      expect(offeredGuestLocaleSchema.safeParse(locale).success).toBe(true)
    }
    expect(guestLocaleSchema.safeParse('pt').success).toBe(false)
    expect(offeredGuestLocaleSchema.safeParse('pt').success).toBe(false)
    expect(offeredGuestLocaleSchema.safeParse('DE').success).toBe(false)
  })

  it('reads at most five additional locales', () => {
    expect(
      additionalGuestLocalesSchema.safeParse(['en', 'es', 'it', 'fr', 'bg']).success,
    ).toBe(true)
    expect(
      additionalGuestLocalesSchema.safeParse(['en', 'es', 'it', 'fr', 'de', 'bg'])
        .success,
    ).toBe(false)
  })
})

describe('guest locale SQL renderings', () => {
  it('renders the locale list as a quoted IN list in catalogue order', () => {
    expect(GUEST_LOCALE_SQL_LIST).toBe("'en', 'es', 'it', 'fr', 'de', 'bg'")
  })

  it('renders the jsonb literal with comma-space separators, as Postgres prints jsonb', () => {
    expect(GUEST_LOCALE_JSONB_LITERAL).toBe('["en", "es", "it", "fr", "de", "bg"]')
    expect(JSON.parse(GUEST_LOCALE_JSONB_LITERAL)).toEqual([...GUEST_LOCALES])
  })

  it('renders a pack pattern that admits every locale and generation but nothing else', () => {
    expect(GUEST_LANGUAGE_PACK_SQL_PATTERN).toBe(
      '^guest-ui-(en|es|it|fr|de|bg)-v[1-9][0-9]{0,2}$',
    )
    const pattern = new RegExp(GUEST_LANGUAGE_PACK_SQL_PATTERN)
    for (const locale of GUEST_LOCALES) {
      expect(pattern.test(`guest-ui-${locale}-v1`)).toBe(true)
      expect(pattern.test(`guest-ui-${locale}-v2`)).toBe(true)
      expect(pattern.test(`guest-ui-${locale}-v999`)).toBe(true)
    }
    for (const rejected of [
      'guest-ui-pt-v1',
      'guest-ui-en-v0',
      'guest-ui-en-v1000',
      'guest-ui-en-v01',
      'guest-ui-en',
      'xguest-ui-en-v1',
      'guest-ui-en-v1x',
    ]) {
      expect(pattern.test(rejected)).toBe(false)
    }
  })

  it('admits every pack id the registry has ever supported', () => {
    const pattern = new RegExp(GUEST_LANGUAGE_PACK_SQL_PATTERN)
    for (const locale of GUEST_LOCALES) {
      for (const pack of GUEST_LANGUAGE_PACKS[locale].supported) {
        expect(pattern.test(pack.id)).toBe(true)
      }
    }
  })
})
