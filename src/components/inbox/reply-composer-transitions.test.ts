import { describe, expect, it } from 'vitest'
import {
  adoptionRevealsReviewLanguage,
  regenerateScope,
  restoreSnapshot,
  type ReplyComposerSnapshot,
} from './reply-composer-transitions'
import { AUTO_DETECT_REVIEW_LANGUAGE } from './reply-language-options'

const detectable = {
  propertyLanguage: 'bg-Cyrl',
  reviewLanguage: 'tr-Latn-TR',
  reviewLanguageReadiness: 'detectable',
} as const

describe('what Undo restores', () => {
  const typed: ReplyComposerSnapshot = {
    draft: { text: 'Благодарим ви за отзива', languageTag: 'bg-Cyrl' },
    adoption: null,
    hasAiDraft: false,
  }

  it('restores the hand-typed draft WITHOUT the provenance of the draft it undoes', () => {
    // The manager's own Bulgarian text, undone back to from a Turkish AI
    // draft: no `AI draft · Turkish` tag may survive over it.
    const restored = restoreSnapshot(typed, {
      detectedReviewLanguage: 'tr-Latn-TR',
      reviewLanguageReadiness: 'detectable',
    })

    expect(restored.snapshot).toEqual(typed)
    expect(restored.selection).toBe('bg-Cyrl')
  })

  it('restores a template adoption undone back to from a later AI draft', () => {
    const template: ReplyComposerSnapshot = {
      draft: { text: 'Шаблон', languageTag: 'bg-Cyrl' },
      adoption: {
        kind: 'library_template',
        languageTag: 'bg-Cyrl',
        template: { templateId: 'tpl-bg', title: 'Guest appreciation' },
      },
      hasAiDraft: false,
    }

    const restored = restoreSnapshot(template, {
      detectedReviewLanguage: null,
      reviewLanguageReadiness: 'detectable',
    })

    expect(restored.snapshot.adoption).toEqual(template.adoption)
    expect(restored.snapshot.hasAiDraft).toBe(false)
  })

  it('keeps a detected review language on a draft that was still detecting', () => {
    const detecting: ReplyComposerSnapshot = {
      draft: { text: 'Thank you', languageTag: null },
      adoption: null,
      hasAiDraft: false,
    }

    const restored = restoreSnapshot(detecting, {
      detectedReviewLanguage: 'en-Latn',
      reviewLanguageReadiness: 'detectable',
    })

    expect(restored.snapshot.draft).toEqual({ text: 'Thank you', languageTag: 'en-Latn' })
    expect(restored.selection).toBe('en-Latn')
  })

  it('returns to automatic detection when nothing was detected on a detectable review', () => {
    const restored = restoreSnapshot(
      { draft: { text: '', languageTag: null }, adoption: null, hasAiDraft: false },
      { detectedReviewLanguage: null, reviewLanguageReadiness: 'detectable' },
    )

    expect(restored.selection).toBe(AUTO_DETECT_REVIEW_LANGUAGE)
  })

  it('selects nothing for an untagged draft on a review that cannot be detected', () => {
    const restored = restoreSnapshot(
      { draft: { text: '', languageTag: null }, adoption: null, hasAiDraft: false },
      { detectedReviewLanguage: null, reviewLanguageReadiness: 'no_review_text' },
    )

    expect(restored.selection).toBeNull()
  })
})

describe('whether an adoption tells the composer the review’s language', () => {
  it('learns it from an AI draft in a language other than the property default', () => {
    expect(
      adoptionRevealsReviewLanguage(
        { kind: 'personalized', languageTag: 'tr-Latn-TR' },
        'bg-Cyrl',
      ),
    ).toBe(true)
  })

  it('learns nothing from an AI draft in the property default, however it is spelled', () => {
    expect(
      adoptionRevealsReviewLanguage(
        { kind: 'personalized', languageTag: 'bg-Cyrl-BG' },
        'bg-Cyrl',
      ),
    ).toBe(false)
  })

  it('learns nothing from a library template, whose language the server already knew', () => {
    // `resolveTargetLanguage` falls back to the property default for an
    // unrecorded review language; treating that tag as the review's language
    // folded the real review option away.
    expect(
      adoptionRevealsReviewLanguage(
        { kind: 'library_template', languageTag: 'tr-Latn-TR' },
        'bg-Cyrl',
      ),
    ).toBe(false)
  })

  it('learns it from any AI draft when the property has no default', () => {
    expect(
      adoptionRevealsReviewLanguage(
        { kind: 'local_fallback', languageTag: 'de-Latn' },
        null,
      ),
    ).toBe(true)
  })

  it('learns nothing from an adoption with no language', () => {
    expect(
      adoptionRevealsReviewLanguage({ kind: 'personalized', languageTag: null }, null),
    ).toBe(false)
  })
})

describe('the scope of a regenerate from the result tag', () => {
  const draft = { text: 'Благодарим ви', languageTag: 'bg-Cyrl' }

  it('asks in the other language without committing it to the draft', () => {
    const scope = regenerateScope(draft, 'tr-Latn-TR', detectable)

    expect(scope).toEqual({
      draft: { text: 'Благодарим ви', languageTag: 'tr-Latn-TR' },
      target: { kind: 'review_language' },
    })
    expect(draft.languageTag).toBe('bg-Cyrl')
  })

  it('asks for detection with no language on the draft it verifies against', () => {
    const scope = regenerateScope(draft, AUTO_DETECT_REVIEW_LANGUAGE, {
      ...detectable,
      reviewLanguage: null,
    })

    expect(scope).toEqual({
      draft: { text: 'Благодарим ви', languageTag: null },
      target: { kind: 'review_language' },
    })
  })
})
