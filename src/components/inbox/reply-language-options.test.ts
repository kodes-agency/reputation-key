import { describe, expect, it } from 'vitest'
import {
  defaultReplyLanguageTag,
  replyLanguageOptions,
  targetForReplyLanguage,
} from './reply-language-options'

describe('reply language options', () => {
  it('defaults to the property language and offers a distinct review language', () => {
    const options = replyLanguageOptions({
      propertyTag: 'bg-Cyrl',
      reviewTag: 'tr-Latn-TR',
      savedTag: null,
    })

    expect(options).toEqual([
      {
        tag: 'bg-Cyrl',
        label: 'Property default · Bulgarian',
        source: 'property',
      },
      {
        tag: 'tr-Latn-TR',
        label: 'Review language · Turkish',
        source: 'review',
      },
    ])
    expect(
      defaultReplyLanguageTag({
        propertyTag: 'bg-Cyrl',
        reviewTag: 'tr-Latn-TR',
        savedTag: null,
      }),
    ).toBe('bg-Cyrl')
  })

  it.each([
    ['bg-Cyrl', 'bg-Cyrl'],
    ['bg-Cyrl', 'bg-Cyrl-BG'],
    ['bg-Cyrl-BG', 'bg-Cyrl'],
  ])(
    'does not duplicate equivalent property %s and review %s language tags',
    (propertyTag, reviewTag) => {
      expect(
        replyLanguageOptions({
          propertyTag,
          reviewTag,
          savedTag: null,
        }),
      ).toHaveLength(1)
    },
  )

  it.each([
    ['bg-Cyrl', 'ru-Cyrl'],
    ['zh-Hans', 'zh-Hant'],
  ])(
    'offers genuinely different property %s and review %s language groups',
    (propertyTag, reviewTag) => {
      expect(
        replyLanguageOptions({
          propertyTag,
          reviewTag,
          savedTag: null,
        }),
      ).toHaveLength(2)
    },
  )

  it('uses the visible canonical choice for an equivalent saved region variant', () => {
    expect(
      replyLanguageOptions({
        propertyTag: 'bg-Cyrl',
        reviewTag: 'tr-Latn',
        savedTag: 'bg-Cyrl-BG',
      }),
    ).toEqual([
      {
        tag: 'bg-Cyrl',
        label: 'Property default · Bulgarian',
        source: 'property',
      },
      {
        tag: 'tr-Latn',
        label: 'Review language · Turkish',
        source: 'review',
      },
    ])
    expect(
      defaultReplyLanguageTag({
        propertyTag: 'bg-Cyrl',
        reviewTag: 'tr-Latn',
        savedTag: 'bg-Cyrl-BG',
      }),
    ).toBe('bg-Cyrl')
  })

  it('preserves a saved draft language and maps governed AI targets', () => {
    expect(
      defaultReplyLanguageTag({
        propertyTag: 'bg-Cyrl',
        reviewTag: 'tr-Latn-TR',
        savedTag: 'de-Latn-DE',
      }),
    ).toBe('de-Latn-DE')
    expect(targetForReplyLanguage('bg-Cyrl', 'bg-Cyrl', 'tr-Latn-TR')).toEqual({
      kind: 'property_default',
    })
    expect(targetForReplyLanguage('tr-Latn-TR', 'bg-Cyrl', 'tr-Latn-TR')).toEqual({
      kind: 'review_language',
    })
    expect(targetForReplyLanguage('bg-Cyrl-BG', 'bg-Cyrl', 'tr-Latn-TR')).toEqual({
      kind: 'property_default',
    })
    expect(targetForReplyLanguage('de-Latn-DE', 'bg-Cyrl', 'tr-Latn-TR')).toBeNull()
  })
})
