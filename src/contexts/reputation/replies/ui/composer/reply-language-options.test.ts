import { describe, expect, it } from 'vitest'
import {
  AUTO_DETECT_REVIEW_LANGUAGE,
  defaultReplyLanguageTag,
  resolveSuggestedReplyLanguageTag,
  replyLanguageOptions,
  reviewLanguageReadiness,
  targetForReplyLanguage,
} from './reply-language-options'

describe('reply language options', () => {
  it('defaults to the property language and offers a distinct review language', () => {
    const options = replyLanguageOptions({
      propertyTag: 'bg-Cyrl',
      reviewTag: 'tr-Latn-TR',
      savedTag: null,
      reviewLanguageReadiness: 'detectable',
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
          reviewLanguageReadiness: 'detectable',
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
          reviewLanguageReadiness: 'detectable',
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
        reviewLanguageReadiness: 'detectable',
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
    expect(
      targetForReplyLanguage('bg-Cyrl', 'bg-Cyrl', 'tr-Latn-TR', 'detectable'),
    ).toEqual({
      kind: 'property_default',
    })
    expect(
      targetForReplyLanguage('tr-Latn-TR', 'bg-Cyrl', 'tr-Latn-TR', 'detectable'),
    ).toEqual({
      kind: 'review_language',
    })
    expect(
      targetForReplyLanguage('bg-Cyrl-BG', 'bg-Cyrl', 'tr-Latn-TR', 'detectable'),
    ).toEqual({
      kind: 'property_default',
    })
    expect(
      targetForReplyLanguage('de-Latn-DE', 'bg-Cyrl', 'tr-Latn-TR', 'detectable'),
    ).toBeNull()
  })

  it('offers governed auto-detection when review metadata is missing but text exists', () => {
    expect(
      replyLanguageOptions({
        propertyTag: 'bg-Cyrl',
        reviewTag: null,
        savedTag: null,
        reviewLanguageReadiness: 'detectable',
      }),
    ).toEqual([
      {
        tag: 'bg-Cyrl',
        label: 'Property default · Bulgarian',
        source: 'property',
      },
      {
        tag: AUTO_DETECT_REVIEW_LANGUAGE,
        label: 'Review language · Detect automatically',
        source: 'review_auto',
      },
    ])

    const target = targetForReplyLanguage(
      AUTO_DETECT_REVIEW_LANGUAGE,
      null,
      null,
      'detectable',
    )

    expect(target).toEqual({ kind: 'review_language' })
    if (target === null) throw new Error('Expected a deferred review-language target')
    expect(resolveSuggestedReplyLanguageTag('tr-Latn', null, target)).toBe('tr-Latn')
  })

  it.each([
    ['no_review_text', 'This review has no text to detect.'],
    [
      'insufficient_language_evidence',
      'This review is too short to detect its language.',
    ],
  ] as const)(
    'keeps automatic detection visible but disabled for %s',
    (readiness, disabledReason) => {
      expect(
        replyLanguageOptions({
          propertyTag: 'bg-Cyrl',
          reviewTag: null,
          savedTag: null,
          reviewLanguageReadiness: readiness,
        }),
      ).toEqual([
        {
          tag: 'bg-Cyrl',
          label: 'Property default · Bulgarian',
          source: 'property',
        },
        {
          tag: AUTO_DETECT_REVIEW_LANGUAGE,
          label: 'Review language · Detect automatically',
          source: 'review_auto',
          disabledReason,
        },
      ])
      expect(
        targetForReplyLanguage(AUTO_DETECT_REVIEW_LANGUAGE, null, null, readiness),
      ).toBeNull()
    },
  )

  it('keeps the configured property language as the default when detection is available', () => {
    expect(
      defaultReplyLanguageTag({
        propertyTag: 'bg-Cyrl',
        reviewTag: null,
        savedTag: null,
      }),
    ).toBe('bg-Cyrl')
  })

  it('does not treat an empty selector value as automatic detection', () => {
    const target = targetForReplyLanguage(null, null, null, 'detectable')

    expect(target).toBeNull()
  })

  it('uses the governed Unicode-letter floor for client readiness', () => {
    expect(reviewLanguageReadiness(null)).toBe('no_review_text')
    expect(reviewLanguageReadiness('1234')).toBe('insufficient_language_evidence')
    expect(reviewLanguageReadiness('Б'.repeat(23))).toBe('insufficient_language_evidence')
    expect(reviewLanguageReadiness('Б'.repeat(24))).toBe('detectable')
  })

  it('accepts only the selected or governed detected canonical suggestion language', () => {
    expect(
      resolveSuggestedReplyLanguageTag('bg-Cyrl', 'bg-Cyrl', {
        kind: 'property_default',
      }),
    ).toBe('bg-Cyrl')
    expect(
      resolveSuggestedReplyLanguageTag('tr-Latn', 'bg-Cyrl', {
        kind: 'property_default',
      }),
    ).toBeNull()
    expect(
      resolveSuggestedReplyLanguageTag('not-a-governed-tag', null, {
        kind: 'review_language',
      }),
    ).toBeNull()
  })
})
