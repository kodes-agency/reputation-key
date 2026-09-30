import { describe, expect, it } from 'vitest'
import type { GuestLanguagePackV2, GuestLocale } from '#/shared/domain/guest-locale'
import { formatGuestPlural, templatePlaceholders } from '../guest-copy-format'
import { bgV2 } from './bg-v2'
import { enV2 } from './en-v2'
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
]

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

  it.each([1, 2, 5])('writes a star count for %i that carries the number', (count) => {
    const text = formatGuestPlural(pack.plurals.ratingStars, count, locale)
    expect(text).toContain(String(count))
    expect(text).not.toContain('{')
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

  it('keeps the word guests where the copy addresses the next person on a shared device', () => {
    expect(enV2.copy.sharedDeviceBody).toMatch(/\bguest\b/i)
    expect(bgV2.copy.sharedDeviceBody).toMatch(/гост/i)
  })

  it('uses "visit" for the counting notice', () => {
    expect(enV2.copy.visitNotice).toMatch(/\bvisits\b/)
    expect(bgV2.copy.visitNotice).toMatch(/посещения/)
  })
})

describe('the two packs read as the same product', () => {
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

  it('is written in Bulgarian, not left in English, for every key that differs by language', () => {
    const untranslated = COPY_KEYS.filter(
      (key) =>
        (bgV2.copy as Record<string, string>)[key] ===
        (enV2.copy as Record<string, string>)[key],
    )
    // Only the brand name, the honeypot-independent tokens and "Sofia time"-style
    // slots may match; everything a guest reads must differ.
    expect(untranslated).toEqual(['ratingOption'])
  })
})
