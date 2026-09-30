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

  it('throws for a locale that has no reviewed pack rather than showing another language', () => {
    expect(() => getGuestPortalCopy('de')).toThrow('No guest language pack exists')
  })
})

// Snapshots pin a pack forever, so the v1 wording may never change by a byte.
// The packs hold functions, so each one is flattened to the text it produces for
// fixed inputs before it is hashed.
const SAMPLE_DEADLINE = '2026-10-04T09:05:00.000Z'
const FUNCTION_INPUTS: Readonly<Record<string, readonly (string | number)[]>> = {
  portalLogoAlt: ['Sample Name'],
  moreFrom: ['Sample Name'],
  ratingLabel: [1, 2, 5],
  ratedExperience: [1, 3, 5],
  privateFeedbackWithdrawalUntil: [SAMPLE_DEADLINE],
  ratingCorrectionUntil: [SAMPLE_DEADLINE],
  responseWithdrawalUntil: [SAMPLE_DEADLINE],
}

function flattenPack(pack: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(pack).map(([key, value]) => {
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
      en: '4d8f602ffec9d1b442e13545fa2f7650f53d966cab44b2dcbdcca4863f50af63',
      bg: 'a61c9466ae8a669c59b07ba60ff3b87ffe8bee7ae06557b76b262289fe06e652',
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
