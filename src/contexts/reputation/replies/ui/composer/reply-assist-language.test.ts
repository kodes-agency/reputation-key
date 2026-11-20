import { describe, expect, it } from 'vitest'
import {
  hasPropertyDefaultOption,
  propertyLanguageMissingReason,
  replyLanguageEntryText,
  replyLanguageMenuEntries,
  selectedReplyLanguageName,
  templateLanguageOptions,
  unresolvedLanguageSubmitReason,
} from './reply-assist-language'
import {
  AUTO_DETECT_REVIEW_LANGUAGE,
  replyLanguageOptions,
  type ReviewLanguageReadiness,
} from './reply-language-options'

const turkishReviewBulgarianProperty = replyLanguageOptions({
  propertyTag: 'bg-Cyrl',
  reviewTag: 'tr-Latn-TR',
  savedTag: null,
  reviewLanguageReadiness: 'detectable',
})

describe('replyLanguageMenuEntries', () => {
  it('names each language and says where it came from as a separate quiet part', () => {
    const entries = replyLanguageMenuEntries(turkishReviewBulgarianProperty, 'bg-Cyrl')

    expect(entries).toEqual([
      {
        tag: 'bg-Cyrl',
        name: 'Bulgarian',
        source: 'property default',
        disabledReason: null,
        isSelected: true,
      },
      {
        tag: 'tr-Latn-TR',
        name: 'Turkish',
        source: 'review language',
        disabledReason: null,
        isSelected: false,
      },
    ])
  })

  it('marks the selection by language, not by spelling, so a region subtag still matches', () => {
    // The AI boundary adopts the CONCRETE tag it verified
    // (`use-reply-composer.ts` adoptDraft → setSelectedLanguage), which can
    // carry a region the option list does not.
    const entries = replyLanguageMenuEntries(turkishReviewBulgarianProperty, 'bg-Cyrl-BG')

    expect(entries.map((entry) => entry.isSelected)).toEqual([true, false])
  })

  it('selects nothing when no language is chosen yet', () => {
    const entries = replyLanguageMenuEntries(turkishReviewBulgarianProperty, null)

    expect(entries.some((entry) => entry.isSelected)).toBe(false)
    expect(selectedReplyLanguageName(entries)).toBeNull()
  })

  it('calls automatic detection by what it does and carries its disabled reason', () => {
    const options = replyLanguageOptions({
      propertyTag: null,
      reviewTag: null,
      savedTag: null,
      reviewLanguageReadiness: 'insufficient_language_evidence',
    })

    const [auto] = replyLanguageMenuEntries(options, null)

    expect(auto).toEqual({
      tag: AUTO_DETECT_REVIEW_LANGUAGE,
      name: 'Detect automatically',
      source: null,
      disabledReason: 'This review is too short to detect its language.',
      isSelected: false,
    })
  })

  it('names a saved draft language that neither target claims', () => {
    const options = replyLanguageOptions({
      propertyTag: 'bg-Cyrl',
      reviewTag: null,
      savedTag: 'de-Latn',
      reviewLanguageReadiness: 'no_review_text',
    })

    const saved = replyLanguageMenuEntries(options, 'de-Latn').at(-1)

    expect(saved).toMatchObject({
      name: 'German',
      source: 'saved draft',
      isSelected: true,
    })
  })
})

describe('replyLanguageEntryText', () => {
  it('joins name and source with a middle dot', () => {
    const [bulgarian] = replyLanguageMenuEntries(turkishReviewBulgarianProperty, null)

    expect(replyLanguageEntryText(bulgarian)).toBe('Bulgarian · property default')
  })

  it('appends a disabled reason after a dash, the pattern the language select used', () => {
    const options = replyLanguageOptions({
      propertyTag: 'bg-Cyrl',
      reviewTag: null,
      savedTag: null,
      reviewLanguageReadiness: 'no_review_text',
    })

    const auto = replyLanguageMenuEntries(options, null)[1]

    expect(replyLanguageEntryText(auto)).toBe(
      'Detect automatically — This review has no text to detect.',
    )
  })
})

describe('selectedReplyLanguageName', () => {
  it('returns the selected language name', () => {
    const entries = replyLanguageMenuEntries(turkishReviewBulgarianProperty, 'tr-Latn-TR')

    expect(selectedReplyLanguageName(entries)).toBe('Turkish')
  })
})

describe('hasPropertyDefaultOption', () => {
  it('is true exactly when replyLanguageOptions was given a property tag', () => {
    expect(hasPropertyDefaultOption(turkishReviewBulgarianProperty)).toBe(true)
    expect(
      hasPropertyDefaultOption(
        replyLanguageOptions({
          propertyTag: null,
          reviewTag: 'tr-Latn-TR',
          savedTag: 'bg-Cyrl',
          reviewLanguageReadiness: 'detectable',
        }),
      ),
    ).toBe(false)
  })
})

describe('propertyLanguageMissingReason', () => {
  it.each<[ReviewLanguageReadiness, boolean, string]>([
    [
      'detectable',
      true,
      'We’ll detect this review’s language for this draft. Set a property default so future replies start in your local language.',
    ],
    [
      'detectable',
      false,
      'Set a property default so future replies start in your local language.',
    ],
    [
      'insufficient_language_evidence',
      false,
      'This review is too short to detect its language. Set a property default to load a local template.',
    ],
    [
      'no_review_text',
      false,
      'This review has no text. Set a property default to load a local template.',
    ],
  ])(
    'explains why the default matters when readiness is %s (auto-detecting: %s)',
    (readiness, isAutoDetecting, expected) => {
      expect(propertyLanguageMissingReason(readiness, isAutoDetecting)).toBe(expected)
    },
  )
})

/**
 * The `Templates in` switch lists only languages the template library can be
 * filtered BY. `reply-template-operations.ts` resolves a `review_language`
 * target from the review's RECORDED language and otherwise falls back to the
 * property default (`resolveTargetLanguage`, `:82-93`) — and GBP records none
 * (`google-review-api.adapter.ts:450`). A segment for automatic detection, or
 * for a language only the AI detected, would list the property's templates
 * under another language's name.
 */
describe('templateLanguageOptions', () => {
  it('keeps the property default and a review language the server recorded', () => {
    const options = templateLanguageOptions(turkishReviewBulgarianProperty, true)

    expect(options.map((option) => option.tag)).toEqual(['bg-Cyrl', 'tr-Latn-TR'])
  })

  it('drops a review language only the AI detected, which the library cannot resolve', () => {
    // `effectiveReviewLanguage` put Turkish on the list after an AI draft;
    // `input.reviewLanguage` is still null.
    const options = templateLanguageOptions(turkishReviewBulgarianProperty, false)

    expect(options.map((option) => option.tag)).toEqual(['bg-Cyrl'])
  })

  it('drops automatic detection, whose target always lists the property default', () => {
    const options = templateLanguageOptions(
      replyLanguageOptions({
        propertyTag: 'bg-Cyrl',
        reviewTag: null,
        savedTag: null,
        reviewLanguageReadiness: 'detectable',
      }),
      false,
    )

    expect(options.map((option) => option.source)).toEqual(['property'])
  })

  it('drops a saved-draft language, which is no target at all', () => {
    const options = templateLanguageOptions(
      replyLanguageOptions({
        propertyTag: 'bg-Cyrl',
        reviewTag: null,
        savedTag: 'de-Latn',
        reviewLanguageReadiness: 'no_review_text',
      }),
      false,
    )

    expect(options.map((option) => option.source)).toEqual(['property'])
  })
})

/**
 * While the composer is detecting the review's language the draft is never
 * autosaved and never submitted (`use-reply-composer.ts`, `canSubmit`); this is
 * the reason Submit is described by instead of a bare disabled button.
 */
describe('unresolvedLanguageSubmitReason', () => {
  it('asks for a reply language when the property has a default to choose', () => {
    expect(unresolvedLanguageSubmitReason(true)).toBe(
      'This reply has no language yet. Choose a reply language to save and submit it.',
    )
  })

  it('names both ways out when the property has no default', () => {
    expect(unresolvedLanguageSubmitReason(false)).toBe(
      'This reply has no language yet. Draft with AI to detect the review’s language, or set a property reply language, to save and submit it.',
    )
  })
})
