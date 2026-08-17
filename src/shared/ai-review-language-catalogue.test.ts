import { afterEach, describe, expect, it, vi } from 'vitest'
import tagVectors from './ai-review-language-tag-v1.vectors.json'
import {
  LANGUAGE_CATALOGUE_DIGEST,
  REPLY_TEMPLATE_LANGUAGE_GROUPS,
  REVIEW_LANGUAGE_GROUPS,
  isAiReviewLanguageRuntimeAvailable,
  mapReviewLanguageMetadata,
  parseCanonicalReplyLanguageTag,
} from './ai-review-language-catalogue'
const PINNED_LANGUAGE_RUNTIME =
  process.versions.node === '22.23.2' &&
  process.versions.unicode === '17.0' &&
  process.versions.icu === '78.2'

const GROUP_CASES = [
  ['en-US', 'en-Latn-US', 'en-Latn'],
  ['es-MX', 'es-Latn-MX', 'es-Latn'],
  ['fr-FR', 'fr-Latn-FR', 'fr-Latn'],
  ['de-DE', 'de-Latn-DE', 'de-Latn'],
  ['pt-BR', 'pt-Latn-BR', 'pt-Latn'],
  ['it-IT', 'it-Latn-IT', 'it-Latn'],
  ['nl-NL', 'nl-Latn-NL', 'nl-Latn'],
  ['pl-PL', 'pl-Latn-PL', 'pl-Latn'],
  ['tr-TR', 'tr-Latn-TR', 'tr-Latn'],
  ['uk-UA', 'uk-Cyrl-UA', 'uk-Cyrl'],
  ['ru-RU', 'ru-Cyrl-RU', 'ru-Cyrl'],
  ['ar-EG', 'ar-Arab-EG', 'ar-Arab'],
  ['he-IL', 'he-Hebr-IL', 'he-Hebr'],
  ['hi-IN', 'hi-Deva-IN', 'hi-Deva'],
  ['bn-BD', 'bn-Beng-BD', 'bn-Beng'],
  ['ta-IN', 'ta-Taml-IN', 'ta-Taml'],
  ['th-TH', 'th-Thai-TH', 'th-Thai'],
  ['vi-VN', 'vi-Latn-VN', 'vi-Latn'],
  ['id-ID', 'id-Latn-ID', 'id-Latn'],
  ['zh-CN', 'zh-Hans-CN', 'zh-Hans'],
  ['zh-TW', 'zh-Hant-TW', 'zh-Hant'],
  ['ja-JP', 'ja-Jpan-JP', 'ja-Jpan'],
  ['ko-KR', 'ko-Kore-KR', 'ko-Kore'],
] as const

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe.runIf(PINNED_LANGUAGE_RUNTIME)('AI review language catalogue', () => {
  it('contains und plus exactly the 23 ordered concrete groups', () => {
    expect(REVIEW_LANGUAGE_GROUPS).toEqual(['und', ...REPLY_TEMPLATE_LANGUAGE_GROUPS])
    expect(REPLY_TEMPLATE_LANGUAGE_GROUPS).toHaveLength(23)
    expect(new Set(REVIEW_LANGUAGE_GROUPS).size).toBe(24)
    expect(LANGUAGE_CATALOGUE_DIGEST).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each(GROUP_CASES)(
    'maps %s to retained tag %s and group %s',
    (metadata, tag, group) => {
      expect(mapReviewLanguageMetadata(metadata)).toMatchObject({
        status: 'supported',
        language: { tag, group },
      })
    },
  )

  it.each([undefined, null, '', ' \t\n ', '\u0085\u3000', 'und', 'zxx', 'und-US'])(
    'maps absent/Unicode-White-Space/und/zxx metadata %s to und',
    (metadata) => {
      expect(mapReviewLanguageMetadata(metadata)).toMatchObject({
        status: 'supported',
        language: { tag: 'und', group: 'und' },
      })
    },
  )

  it.each([
    'x-private',
    'en\u0000-US',
    '\uFEFFen-US',
    'a',
    'not_a_tag',
    `${'a'.repeat(65)}`,
  ])('rejects malformed metadata %s without mapping to und', (metadata) => {
    expect(mapReviewLanguageMetadata(metadata)).toEqual({
      status: 'language_not_supported',
      reason: 'malformed_metadata',
    })
  })

  it.each(['sw-Latn', 'el-Grek', 'sr-Cyrl', 'zh-Latn'])(
    'rejects unsupported group %s',
    (metadata) => {
      expect(mapReviewLanguageMetadata(metadata)).toEqual({
        status: 'language_not_supported',
        reason: 'unsupported_group',
      })
    },
  )

  it('drops variants/extensions/private-use while retaining only an explicit region', () => {
    expect(mapReviewLanguageMetadata('de-DE-1996-u-co-phonebk-x-private')).toMatchObject({
      status: 'supported',
      language: { tag: 'de-Latn-DE', group: 'de-Latn' },
    })
    expect(mapReviewLanguageMetadata('en')).toMatchObject({
      status: 'supported',
      language: { tag: 'en-Latn', group: 'en-Latn' },
    })
  })

  it.each([
    ['en-UK', 'en-Latn-GB', 'en-Latn'],
    ['en-BU', 'en-Latn-MM', 'en-Latn'],
    ['en-DD', 'en-Latn-DE', 'en-Latn'],
    ['en-FX', 'en-Latn-FR', 'en-Latn'],
    ['en-TP', 'en-Latn-TL', 'en-Latn'],
    ['en-YD', 'en-Latn-YE', 'en-Latn'],
    ['en-ZR', 'en-Latn-CD', 'en-Latn'],
  ] as const)(
    'canonicalizes region alias %s before constructing %s',
    (metadata, tag, group) => {
      const result = mapReviewLanguageMetadata(metadata)
      expect(result).toMatchObject({ status: 'supported', language: { tag, group } })
      if (result.status !== 'supported' || result.language.group === 'und') {
        throw new Error('Expected a concrete supported mapping')
      }
      expect(parseCanonicalReplyLanguageTag(result.language.tag)).toEqual({
        tag,
        templateGroup: group,
      })
    },
  )

  it.each(['en-AA', 'en-999'])(
    'rejects unknown canonical region metadata %s before constructing a tag',
    (metadata) => {
      expect(mapReviewLanguageMetadata(metadata)).toEqual({
        status: 'language_not_supported',
        reason: 'malformed_metadata',
      })
    },
  )

  it.each(GROUP_CASES)(
    'produces parser-total concrete mapper output for %s',
    (metadata, tag, group) => {
      const result = mapReviewLanguageMetadata(metadata)
      expect(result.status).toBe('supported')
      if (result.status !== 'supported' || result.language.group === 'und') {
        throw new Error('Expected a concrete supported mapping')
      }
      expect(parseCanonicalReplyLanguageTag(result.language.tag)).toEqual({
        tag,
        templateGroup: group,
      })
    },
  )

  it('fails closed when only the Node runtime version drifts', () => {
    vi.spyOn(process.versions, 'node', 'get').mockReturnValue('22.23.3')
    expect(isAiReviewLanguageRuntimeAvailable()).toBe(false)
    expect(mapReviewLanguageMetadata('en-US')).toEqual({ status: 'policy_unavailable' })
  })

  it('fails closed when the pinned Intl.Locale runtime is unavailable', () => {
    vi.stubGlobal('Intl', {
      ...Intl,
      Locale: class {
        constructor() {
          throw new Error('fault')
        }
      },
    })
    expect(mapReviewLanguageMetadata('en-US')).toEqual({ status: 'policy_unavailable' })
  })
})

describe.runIf(!PINNED_LANGUAGE_RUNTIME)(
  'AI review language catalogue runtime fence',
  () => {
    it('fails closed before mapping on a non-pinned ICU runtime', () => {
      expect(mapReviewLanguageMetadata('en-US')).toEqual({ status: 'policy_unavailable' })
      expect(mapReviewLanguageMetadata(null)).toEqual({ status: 'policy_unavailable' })
    })
  },
)

describe('canonical concrete reply language tag parser', () => {
  it.each(tagVectors)(
    'parses only exact canonical mapper output $value',
    ({ value, templateGroup }) => {
      const parsed = parseCanonicalReplyLanguageTag(value)
      if (templateGroup === null) {
        expect(parsed).toBeNull()
        return
      }
      expect(parsed).toEqual({ tag: value, templateGroup })
    },
  )
})
