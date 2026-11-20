import { describe, expect, it } from 'vitest'
import { replyLanguageMenuEntries } from './reply-assist-language'
import { regenerateChoices, replyDraftOriginParts } from './reply-draft-origin-view'
import {
  AUTO_DETECT_REVIEW_LANGUAGE,
  replyLanguageOptions,
} from './reply-language-options'

const bulgarianPropertyTurkishReview = replyLanguageMenuEntries(
  replyLanguageOptions({
    propertyTag: 'bg-Cyrl',
    reviewTag: 'tr-Latn-TR',
    savedTag: null,
    reviewLanguageReadiness: 'detectable',
  }),
  'bg-Cyrl',
)

describe('replyDraftOriginParts', () => {
  it('names an AI draft and the language it was drafted in', () => {
    const parts = replyDraftOriginParts({ kind: 'ai_draft', languageTag: 'bg-Cyrl-BG' })

    expect(parts).toEqual({ kind: 'AI draft', title: null, language: 'Bulgarian' })
  })

  it('names a library template by its title, then its language', () => {
    const parts = replyDraftOriginParts({
      kind: 'template',
      templateId: 'tpl-1',
      title: 'Guest appreciation',
      languageTag: 'en-Latn-US',
    })

    expect(parts).toEqual({
      kind: 'Template',
      title: 'Guest appreciation',
      language: 'English',
    })
  })

  it('drops the title rather than inventing one for a local safe template', () => {
    const parts = replyDraftOriginParts({
      kind: 'template',
      templateId: null,
      title: null,
      languageTag: 'bg-Cyrl',
    })

    expect(parts).toEqual({ kind: 'Template', title: null, language: 'Bulgarian' })
  })

  it('has no language part when none was recorded', () => {
    const parts = replyDraftOriginParts({ kind: 'ai_draft', languageTag: null })

    expect(parts).toEqual({ kind: 'AI draft', title: null, language: null })
  })
})

describe('regenerateChoices', () => {
  it('offers the other target and not the language the draft is already in', () => {
    const choices = regenerateChoices(bulgarianPropertyTurkishReview, 'bg-Cyrl-BG')

    expect(choices).toEqual([
      { tag: 'tr-Latn-TR', label: 'Regenerate in Turkish', source: 'review language' },
    ])
  })

  it('offers the property default from a draft in the review language', () => {
    const turkishSelected = replyLanguageMenuEntries(
      replyLanguageOptions({
        propertyTag: 'bg-Cyrl',
        reviewTag: 'tr-Latn-TR',
        savedTag: null,
        reviewLanguageReadiness: 'detectable',
      }),
      'tr-Latn-TR',
    )

    const choices = regenerateChoices(turkishSelected, 'tr-Latn')

    expect(choices).toEqual([
      { tag: 'bg-Cyrl', label: 'Regenerate in Bulgarian', source: 'property default' },
    ])
  })

  it('offers the draft’s own language back once `Write in` has moved away from it', () => {
    // A Turkish AI draft, then `Write in` → Bulgarian. `Draft with AI` now
    // drafts in Bulgarian, so the only way back to a fresh Turkish draft is
    // this menu — and `Regenerate in Bulgarian` is kept too, because it is
    // the row that says which language the button beside it will use.
    const choices = regenerateChoices(bulgarianPropertyTurkishReview, 'tr-Latn-TR')

    expect(choices).toEqual([
      { tag: 'bg-Cyrl', label: 'Regenerate in Bulgarian', source: 'property default' },
      { tag: 'tr-Latn-TR', label: 'Regenerate in Turkish', source: 'review language' },
    ])
  })

  it('keeps automatic detection as a target while the review language is unknown', () => {
    const entries = replyLanguageMenuEntries(
      replyLanguageOptions({
        propertyTag: 'bg-Cyrl',
        reviewTag: null,
        savedTag: null,
        reviewLanguageReadiness: 'detectable',
      }),
      'bg-Cyrl',
    )

    expect(regenerateChoices(entries, 'bg-Cyrl')).toEqual([
      {
        tag: AUTO_DETECT_REVIEW_LANGUAGE,
        label: 'Regenerate in the review’s language',
        source: null,
      },
    ])
  })

  it('leaves out a disabled detection and a saved-draft language, which are not targets', () => {
    const entries = replyLanguageMenuEntries(
      replyLanguageOptions({
        propertyTag: 'bg-Cyrl',
        reviewTag: null,
        savedTag: 'de-Latn',
        reviewLanguageReadiness: 'insufficient_language_evidence',
      }),
      'bg-Cyrl',
    )

    // Arrange sanity: both excluded kinds really are in the list.
    expect(entries.map((entry) => entry.source)).toEqual([
      'property default',
      null,
      'saved draft',
    ])
    expect(regenerateChoices(entries, 'bg-Cyrl')).toEqual([])
  })
})
