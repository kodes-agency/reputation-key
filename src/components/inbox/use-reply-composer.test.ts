import { describe, expect, it } from 'vitest'
import { AUTO_DETECT_REVIEW_LANGUAGE } from './reply-language-options'
import { assistTargetFor, draftInLanguage } from './use-reply-composer'

const detectable = {
  propertyLanguage: 'bg-Cyrl',
  reviewLanguage: 'tr-Latn',
  reviewLanguageReadiness: 'detectable',
} as const

describe('assist target for a language selection', () => {
  it('runs the property default in the property-default target', () => {
    expect(assistTargetFor('bg-Cyrl', detectable)).toEqual({ kind: 'property_default' })
  })

  it("runs the review's language in the review-language target", () => {
    expect(assistTargetFor('tr-Latn', detectable)).toEqual({ kind: 'review_language' })
  })

  it('runs automatic detection in the review-language target when the review is detectable', () => {
    expect(
      assistTargetFor(AUTO_DETECT_REVIEW_LANGUAGE, {
        ...detectable,
        reviewLanguage: null,
      }),
    ).toEqual({ kind: 'review_language' })
  })

  it('has no target for automatic detection on a review too short to detect', () => {
    expect(
      assistTargetFor(AUTO_DETECT_REVIEW_LANGUAGE, {
        propertyLanguage: null,
        reviewLanguage: null,
        reviewLanguageReadiness: 'insufficient_language_evidence',
      }),
    ).toBeNull()
  })

  it('still loads templates in the review-language target with nothing selected and no detectable review', () => {
    expect(
      assistTargetFor(null, {
        propertyLanguage: null,
        reviewLanguage: null,
        reviewLanguageReadiness: 'no_review_text',
      }),
    ).toEqual({ kind: 'review_language' })
  })

  it('has no target with nothing selected on a detectable review', () => {
    expect(assistTargetFor(null, { ...detectable, propertyLanguage: null })).toBeNull()
  })

  it('has no target for a saved tag that is neither the property nor the review language', () => {
    expect(assistTargetFor('de-Latn', detectable)).toBeNull()
  })
})

describe('draft committed by a language change', () => {
  const draft = { text: 'Благодарим ви', languageTag: 'bg-Cyrl' }

  it('stamps a concrete language on the draft and keeps its text', () => {
    expect(draftInLanguage(draft, 'tr-Latn')).toEqual({
      text: 'Благодарим ви',
      languageTag: 'tr-Latn',
    })
  })

  it('carries no language while detecting automatically', () => {
    expect(draftInLanguage(draft, AUTO_DETECT_REVIEW_LANGUAGE)).toEqual({
      text: 'Благодарим ви',
      languageTag: null,
    })
  })

  it('returns a new draft rather than changing the one it was given', () => {
    const next = draftInLanguage(draft, 'tr-Latn')
    expect(next).not.toBe(draft)
    expect(draft.languageTag).toBe('bg-Cyrl')
  })
})
