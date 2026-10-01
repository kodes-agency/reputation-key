import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getGuestPortalCopy } from './guest-language-pack'
import { resolvePortalLocale } from './portal-localization'

describe('guest Portal language packs', () => {
  it('resolves the exact immutable English and Bulgarian v1 packs', () => {
    expect(getGuestPortalCopy('en', 'guest-ui-en-v1')).toMatchObject({
      locale: 'en',
      version: 'guest-ui-en-v1',
      submitPrivateRating: 'Submit private rating',
    })
    expect(getGuestPortalCopy('bg', 'guest-ui-bg-v1')).toMatchObject({
      locale: 'bg',
      version: 'guest-ui-bg-v1',
      submitPrivateRating: 'Изпрати непубличната оценка',
    })
  })

  it('fails closed instead of rendering copy from a different pinned locale', () => {
    expect(() => getGuestPortalCopy('bg', 'guest-ui-en-v1')).toThrow(
      'Guest locale and immutable language pack do not match',
    )
  })

  it('defaults to the locale\u2019s current pack when none is pinned', () => {
    expect(getGuestPortalCopy('en').version).toBe('guest-ui-en-v1')
    expect(getGuestPortalCopy('bg').version).toBe('guest-ui-bg-v1')
    expect(getGuestPortalCopy().locale).toBe('en')
  })

  it('throws for a locale that has no generation 1 pack rather than showing another language', () => {
    expect(() => getGuestPortalCopy('de')).toThrow('No guest language pack exists')
  })
})

// Snapshots pin a pack forever, so the v1 wording may never change by a byte.
// The packs hold functions, so each one is flattened to the text it produces for
// fixed inputs before it is hashed. The three deadline sentences render a date
// through ICU, so an ICU change (a Node upgrade) can alter them without any
// pack change: they are left out of the hash and pinned as readable literals in
// their own test, where a change shows as a diff instead of an opaque hash.
const SAMPLE_DEADLINE = '2026-10-04T09:05:00.000Z'
const FUNCTION_INPUTS: Readonly<Record<string, readonly (string | number)[]>> = {
  portalLogoAlt: ['Sample Name'],
  moreFrom: ['Sample Name'],
  ratingLabel: [1, 2, 5],
  ratedExperience: [1, 3, 5],
}
const DEADLINE_KEYS = [
  'privateFeedbackWithdrawalUntil',
  'ratingCorrectionUntil',
  'responseWithdrawalUntil',
] as const

const deadlinesOf = (pack: object): Record<string, string> =>
  Object.fromEntries(
    DEADLINE_KEYS.map((key) => [
      key,
      ((pack as Record<string, (value: string) => string>)[key] as (v: string) => string)(
        SAMPLE_DEADLINE,
      ),
    ]),
  )

function flattenPack(pack: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(pack)
      .filter(([key]) => !(DEADLINE_KEYS as readonly string[]).includes(key))
      .map(([key, value]) => {
        if (typeof value !== 'function') return [key, value]
        const call = value as (input: string | number) => string
        return [key, (FUNCTION_INPUTS[key] ?? []).map((input) => call(input))]
      }),
  )
}

const digestOf = (pack: object): string =>
  createHash('sha256')
    .update(JSON.stringify(flattenPack(pack)))
    .digest('hex')

describe('the frozen v1 packs', () => {
  it('produce byte-identical copy to what shipped with schema versions 1 and 2', () => {
    expect({
      en: digestOf(getGuestPortalCopy('en', 'guest-ui-en-v1')),
      bg: digestOf(getGuestPortalCopy('bg', 'guest-ui-bg-v1')),
    }).toEqual({
      en: 'f242e75323415b8af379ecfb6aa921e0a0ef14b4560a7b96cfc7e661f4fc1a69',
      bg: 'c65070bffadc3340824040f0ba8d6e28f7c6fe22ac3637873711637df722e5e1',
    })
  })

  it('write the deadline sentences exactly as they shipped (Node 22 ICU)', () => {
    expect({
      en: deadlinesOf(getGuestPortalCopy('en', 'guest-ui-en-v1')),
      bg: deadlinesOf(getGuestPortalCopy('bg', 'guest-ui-bg-v1')),
    }).toEqual({
      en: {
        privateFeedbackWithdrawalUntil:
          'Private-feedback withdrawal is available until Oct 4, 2026, 9:05 AM.',
        ratingCorrectionUntil:
          'Rating correction is available until Oct 4, 2026, 9:05 AM.',
        responseWithdrawalUntil:
          'Complete response withdrawal is available until Oct 4, 2026, 9:05 AM.',
      },
      bg: {
        privateFeedbackWithdrawalUntil:
          'Можете да оттеглите непубличната обратна връзка до 4.10.2026 г., 9:05.',
        ratingCorrectionUntil: 'Можете да промените оценката си до 4.10.2026 г., 9:05.',
        responseWithdrawalUntil:
          'Можете да оттеглите целия отговор до 4.10.2026 г., 9:05.',
      },
    })
  })

  it('refuse a generation 2 pack id instead of rendering template copy as v1 copy', () => {
    expect(() => getGuestPortalCopy('en', 'guest-ui-en-v2')).toThrow(
      'guest-ui-en-v2 is not a generation 1 guest language pack',
    )
  })
})

describe('resolvePortalLocale', () => {
  it('falls back to English with no localization state', () => {
    expect(resolvePortalLocale(undefined)).toEqual({
      selectedLocale: 'en',
      languagePackVersion: 'guest-ui-en-v1',
    })
  })

  it('uses the pack the snapshot pinned, else the locale\u2019s current pack', () => {
    const base = { primaryLocale: 'en', availableLocales: ['en', 'bg'] } as const
    expect(resolvePortalLocale({ ...base, selectedLocale: 'bg' })).toEqual({
      selectedLocale: 'bg',
      languagePackVersion: 'guest-ui-bg-v1',
    })
    expect(
      resolvePortalLocale({
        ...base,
        selectedLocale: 'en',
        languagePackVersion: 'guest-ui-en-v1',
      }).languagePackVersion,
    ).toBe('guest-ui-en-v1')
  })

  it('throws for a locale with no pack', () => {
    expect(() =>
      resolvePortalLocale({
        selectedLocale: 'fr',
        primaryLocale: 'en',
        availableLocales: ['en', 'fr'],
      }),
    ).toThrow('No guest language pack exists')
  })
})
