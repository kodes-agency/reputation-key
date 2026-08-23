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

  it('does not duplicate the review language when it matches the property', () => {
    expect(
      replyLanguageOptions({
        propertyTag: 'bg-Cyrl',
        reviewTag: 'bg-Cyrl',
        savedTag: null,
      }),
    ).toHaveLength(1)
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
    expect(targetForReplyLanguage('de-Latn-DE', 'bg-Cyrl', 'tr-Latn-TR')).toBeNull()
  })
})
