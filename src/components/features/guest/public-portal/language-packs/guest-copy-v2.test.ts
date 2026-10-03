import { describe, expect, it } from 'vitest'
import {
  GUEST_LOCALE_METADATA,
  GUEST_LOCALES,
  type GuestLanguagePackV2,
  type GuestLocale,
} from '#/shared/domain/guest-locale'
import { formatGuestPlural, templatePlaceholders } from '../guest-copy-format'
import { bgV2 } from './bg-v2'
import { deV2 } from './de-v2'
import { enV2 } from './en-v2'
import { esV2 } from './es-v2'
import { frV2 } from './fr-v2'
import { itV2 } from './it-v2'
import {
  GUEST_COPY_V2_PLACEHOLDERS,
  GUEST_PLURAL_V2_PLACEHOLDERS,
  type GuestPortalCopyV2,
} from './guest-copy-v2'

const PACKS: ReadonlyArray<
  Readonly<{ locale: GuestLocale; version: GuestLanguagePackV2; pack: GuestPortalCopyV2 }>
> = [
  { locale: 'en', version: 'guest-ui-en-v2', pack: enV2 },
  { locale: 'bg', version: 'guest-ui-bg-v2', pack: bgV2 },
  { locale: 'es', version: 'guest-ui-es-v2', pack: esV2 },
  { locale: 'it', version: 'guest-ui-it-v2', pack: itV2 },
  { locale: 'fr', version: 'guest-ui-fr-v2', pack: frV2 },
  { locale: 'de', version: 'guest-ui-de-v2', pack: deV2 },
]

// Exact CLDR forms: every locale has one/other for these counts (fr, es and it
// also have `many`, which only applies from a million up).
const EXPECTED_STARS: Record<GuestLocale, Record<number, string>> = {
  en: { 1: '1 star', 2: '2 stars', 5: '5 stars' },
  bg: { 1: '1 звезда', 2: '2 звезди', 5: '5 звезди' },
  es: { 1: '1 estrella', 2: '2 estrellas', 5: '5 estrellas' },
  it: { 1: '1 stella', 2: '2 stelle', 5: '5 stelle' },
  fr: { 1: '1 étoile', 2: '2 étoiles', 5: '5 étoiles' },
  de: { 1: '1 Stern', 2: '2 Sterne', 5: '5 Sterne' },
}

const COPY_KEYS = Object.keys(GUEST_COPY_V2_PLACEHOLDERS)
const PLURAL_KEYS = Object.keys(GUEST_PLURAL_V2_PLACEHOLDERS)

describe.each(PACKS)('guest copy pack $version', ({ locale, version, pack }) => {
  it('names its own locale and version', () => {
    expect(pack.locale).toBe(locale)
    expect(pack.version).toBe(version)
  })

  it('has exactly the keys of the v2 key set: none missing, none extra', () => {
    expect(Object.keys(pack.copy).sort()).toEqual([...COPY_KEYS].sort())
    expect(Object.keys(pack.plurals).sort()).toEqual([...PLURAL_KEYS].sort())
  })

  it.each(COPY_KEYS)(
    '%s is written, trimmed and uses only its own placeholders',
    (key) => {
      const text = (pack.copy as Record<string, string>)[key]
      expect(typeof text).toBe('string')
      expect(text).toBe(text?.trim())
      expect(text?.length).toBeGreaterThan(0)
      const expected = (GUEST_COPY_V2_PLACEHOLDERS as Record<string, readonly string[]>)[
        key
      ]
      expect([...templatePlaceholders(text ?? '')].sort()).toEqual(
        [...(expected ?? [])].sort(),
      )
    },
  )

  it.each(PLURAL_KEYS)(
    'plural %s has an "other" form and its own placeholders',
    (key) => {
      const forms = (pack.plurals as Record<string, Record<string, string>>)[key]
      const expected = (
        GUEST_PLURAL_V2_PLACEHOLDERS as Record<string, readonly string[]>
      )[key]
      expect(forms?.other).toBeTruthy()
      for (const text of Object.values(forms ?? {})) {
        expect([...templatePlaceholders(text)].sort()).toEqual(
          [...(expected ?? [])].sort(),
        )
      }
    },
  )

  it('serialises to JSON and back without losing anything', () => {
    expect(JSON.parse(JSON.stringify(pack))).toEqual(pack)
  })

  it('is deeply frozen so a request cannot change another request’s copy', () => {
    expect(Object.isFrozen(pack)).toBe(true)
    expect(Object.isFrozen(pack.copy)).toBe(true)
    expect(Object.isFrozen(pack.plurals)).toBe(true)
  })

  it.each([1, 2, 5])('writes the exact star count form for %i', (count) => {
    expect(formatGuestPlural(pack.plurals.ratingStars, count, locale)).toBe(
      EXPECTED_STARS[locale]?.[count],
    )
  })

  it('names every zone it translates by its IANA id, with a written place name', () => {
    for (const [zone, name] of Object.entries(pack.zoneNames)) {
      expect(zone).toMatch(/^[A-Z][A-Za-z_+-]*(\/[A-Z][A-Za-z_+-]*)*$/)
      expect(name).toBe(name.trim())
      expect(name.length).toBeGreaterThan(0)
    }
  })
})

describe('the copy is industry-neutral', () => {
  const everyString = (pack: GuestPortalCopyV2): string[] => [
    ...Object.values(pack.copy),
    ...Object.values(pack.plurals).flatMap((forms) => Object.values(forms)),
  ]

  it('never says "stay" or names a kind of place in English', () => {
    const banned =
      /\b(stay|stays|stayed|staying|hotel|resort|restaurant|villa|apartment|guesthouse)\b/i
    expect(everyString(enV2).filter((text) => banned.test(text))).toEqual([])
  })

  it('never says "stay" or names a kind of place in Bulgarian', () => {
    const banned = /(престо[йя]|хотел|курорт|ресторант|вил[аи]\b|апартамент)/i
    expect(everyString(bgV2).filter((text) => banned.test(text))).toEqual([])
  })

  // A guest has a visit, never a stay, and no text names a kind of place.
  it.each([
    [
      'es',
      esV2,
      /\b(estancia|estancias|hotel|resort|restaurante|villa|apartamento|alojamiento)\b/i,
    ],
    [
      'it',
      itV2,
      /\b(soggiorno|soggiorni|hotel|resort|ristorante|villa|appartamento|alloggio)\b/i,
    ],
    [
      'fr',
      frV2,
      /\b(séjour|séjours|hôtel|hotel|resort|restaurant|villa|appartement|hébergement)\b/i,
    ],
    [
      'de',
      deV2,
      /\b(Aufenthalt|Hotel|Resort|Restaurant|Villa|Apartment|Unterkunft|Übernachtung)\b/i,
    ],
  ] as const)(
    'never says "stay" or names a kind of place in %s',
    (_locale, pack, banned) => {
      expect(everyString(pack).filter((text) => banned.test(text))).toEqual([])
    },
  )

  it('keeps the word guest where the copy addresses the next person on a shared device', () => {
    expect(enV2.copy.sharedDeviceBody).toMatch(/\bguest\b/i)
    expect(bgV2.copy.sharedDeviceBody).toMatch(/гост/i)
    expect(esV2.copy.sharedDeviceBody).toMatch(/huésped/i)
    expect(itV2.copy.sharedDeviceBody).toMatch(/ospite/i)
    expect(frV2.copy.sharedDeviceBody).toMatch(/invité/i)
    expect(deV2.copy.sharedDeviceBody).toMatch(/\bGast\b/)
  })

  it('uses "visit" for the counting notice', () => {
    expect(enV2.copy.visitNotice).toMatch(/\bvisits\b/)
    expect(bgV2.copy.visitNotice).toMatch(/посещения/)
    expect(esV2.copy.visitNotice).toMatch(/\bvisitas\b/)
    expect(itV2.copy.visitNotice).toMatch(/\bvisite\b/)
    expect(frV2.copy.visitNotice).toMatch(/\bvisites\b/)
    expect(deV2.copy.visitNotice).toMatch(/\bBesuche\b/)
  })
})

// ADR 0044: whatever notice a guest reads must disclose the essential cookie
// and the privacy-protected marker. Owner decision (2026-10-01): the footer
// shows ONE line, `visitNotice`, in every language, and there is no longer
// text behind it, so that line carries the whole disclosure.
describe('the visit notice (ADR 0044)', () => {
  it('is the owner-approved one line in English', () => {
    expect(enV2.copy.visitNotice).toBe(
      '{name} counts visits with one essential cookie and a privacy-protected marker. No ads or third-party trackers.',
    )
  })

  it('has no longer disclosure behind it', () => {
    for (const pack of [enV2, bgV2, esV2, itV2, frV2, deV2]) {
      expect(Object.keys(pack.copy)).not.toContain('visitNoticeDetail')
    }
  })

  it.each([
    ['es', esV2, /\bcookie\b/i, /\bmarcador\b/i, /\bterceros\b/],
    ['it', itV2, /\bcookie\b/i, /\bmarcatore\b/i, /\bterze parti\b/],
    ['fr', frV2, /\bcookie\b/i, /\bmarqueur\b/i, /\btiers\b/],
    ['de', deV2, /\bCookie\b/, /\bMarker\b/, /\bDritten\b/],
    ['bg', bgV2, /бисквитка/i, /маркер/i, /трети страни/],
  ] as const)(
    'names the essential cookie, the marker and the absence of third parties in %s',
    (_locale, pack, cookie, marker, thirdParties) => {
      expect(pack.copy.visitNotice).toMatch(cookie)
      expect(pack.copy.visitNotice).toMatch(marker)
      expect(pack.copy.visitNotice).toMatch(thirdParties)
    },
  )

  it('starts with the property name and is a single line of two sentences in every language', () => {
    for (const pack of [enV2, bgV2, esV2, itV2, frV2, deV2]) {
      expect(pack.copy.visitNotice.startsWith('{name} ')).toBe(true)
      expect(pack.copy.visitNotice).not.toMatch(/\n/u)
    }
  })
})

describe('the language sheet and link labels', () => {
  it('names every guest locale in the pack’s own language', () => {
    expect(enV2.copy).toMatchObject({
      languageNameEn: 'English',
      languageNameBg: 'Bulgarian',
      languageNameEs: 'Spanish',
      languageNameIt: 'Italian',
      languageNameFr: 'French',
      languageNameDe: 'German',
    })
    expect(bgV2.copy).toMatchObject({
      languageNameEn: 'Английски',
      languageNameBg: 'Български',
      languageNameEs: 'Испански',
      languageNameIt: 'Италиански',
      languageNameFr: 'Френски',
      languageNameDe: 'Немски',
    })
    expect(esV2.copy).toMatchObject({
      languageNameEn: 'Inglés',
      languageNameBg: 'Búlgaro',
      languageNameEs: 'Español',
      languageNameIt: 'Italiano',
      languageNameFr: 'Francés',
      languageNameDe: 'Alemán',
    })
    expect(itV2.copy).toMatchObject({
      languageNameEn: 'Inglese',
      languageNameBg: 'Bulgaro',
      languageNameEs: 'Spagnolo',
      languageNameIt: 'Italiano',
      languageNameFr: 'Francese',
      languageNameDe: 'Tedesco',
    })
    expect(frV2.copy).toMatchObject({
      languageNameEn: 'Anglais',
      languageNameBg: 'Bulgare',
      languageNameEs: 'Espagnol',
      languageNameIt: 'Italien',
      languageNameFr: 'Français',
      languageNameDe: 'Allemand',
    })
    expect(deV2.copy).toMatchObject({
      languageNameEn: 'Englisch',
      languageNameBg: 'Bulgarisch',
      languageNameEs: 'Spanisch',
      languageNameIt: 'Italienisch',
      languageNameFr: 'Französisch',
      languageNameDe: 'Deutsch',
    })
  })

  it('names each language in its own pack exactly as the catalogue writes it natively', () => {
    const keyOf = (code: GuestLocale) =>
      `languageName${code[0]?.toUpperCase()}${code[1]}` as keyof GuestPortalCopyV2['copy']
    for (const { locale, pack } of PACKS) {
      expect(pack.copy[keyOf(locale)]).toBe(GUEST_LOCALE_METADATA[locale].nativeName)
    }
  })

  it('has one language name key per guest locale', () => {
    const keys = COPY_KEYS.filter((key) => key.startsWith('languageName')).sort()
    expect(keys).toEqual(
      GUEST_LOCALES.map(
        (code) => `languageName${code[0]?.toUpperCase()}${code[1]}`,
      ).sort(),
    )
  })

  it('has a generic screen-reader label for a link that opens a new tab', () => {
    expect(enV2.copy.linkOpensNewTab).toBe('(opens in a new tab)')
    expect(bgV2.copy.linkOpensNewTab).toBe('(отваря се в нов раздел)')
    expect(esV2.copy.linkOpensNewTab).toBe('(se abre en una pestaña nueva)')
    expect(itV2.copy.linkOpensNewTab).toBe('(si apre in una nuova scheda)')
    expect(frV2.copy.linkOpensNewTab).toBe('(s’ouvre dans un nouvel onglet)')
    expect(deV2.copy.linkOpensNewTab).toBe('(öffnet in neuem Tab)')
  })
})

describe('the packs read as the same product', () => {
  it('give each rating a distinct word, in order', () => {
    for (const { pack } of PACKS) {
      const words = [1, 2, 3, 4, 5].map(
        (n) => pack.copy[`ratingWord${n as 1 | 2 | 3 | 4 | 5}` as const],
      )
      expect(new Set(words).size).toBe(5)
    }
  })

  it('use the outer scale words for the ends of the scale', () => {
    for (const { pack } of PACKS) {
      expect(pack.copy.ratingScaleLow).toBe(pack.copy.ratingWord1)
      expect(pack.copy.ratingScaleHigh).toBe(pack.copy.ratingWord5)
    }
  })

  // The packs were drafted without a native check (owner decision 5), so the
  // one failure a test can still catch is a text left in English. Words that
  // really are the same in both languages are listed here, per locale, and a
  // listed key must still be equal: an entry that stopped matching is stale.
  const SAME_AS_ENGLISH: Readonly<Record<GuestLocale, readonly string[]>> = {
    en: [],
    bg: ['ratingOption'],
    es: ['ratingOption'],
    it: ['ratingOption'],
    fr: ['ratingOption'],
    de: ['ratingOption'],
  }

  it.each(PACKS.filter(({ locale }) => locale !== 'en'))(
    'is written in the language of $locale, not left in English, for every key that differs by language',
    ({ locale, pack }) => {
      const untranslated = COPY_KEYS.filter(
        (key) =>
          (pack.copy as Record<string, string>)[key] ===
          (enV2.copy as Record<string, string>)[key],
      )
      expect(untranslated).toEqual([...SAME_AS_ENGLISH[locale]])
    },
  )
})
