import { describe, expect, it } from 'vitest'
import { presentGuestReviewBody, type GuestReviewBodyInput } from './guest-message-view'

const TURKISH_REVIEW = 'Harika bir konaklama oldu, tekrar geleceğiz.'
const BULGARIAN_REVIEW = 'Хотелът беше чист и уютен.'
/**
 * Google's translations are ENGLISH in every fixture below, because that is
 * what the ingest path receives: Google picks the target from the reader
 * locale at fetch time (`google-review-api.adapter.ts:454-457`), and this repo
 * measured the translated half of 8 Bulgarian reviews as English
 * (`google-review-comment.ts:8-10`). An earlier fixture translated Turkish into
 * Bulgarian — a pairing the pipeline cannot produce, and one that made
 * "the body is the text the reader can read" look proven when it is not.
 */
const TURKISH_TRANSLATION = 'It was a great stay, we will come again.'
const BULGARIAN_TRANSLATION = 'The hotel was clean and cosy.'

/**
 * A Turkish review read in a property that replies in Bulgarian, with BOTH
 * languages known — the only input on which plan row 8 promotes the
 * translation. `reviewLanguageTag` is what `get-inbox-item-detail.ts:183-188`
 * canonicalizes `tr-TR` into; `reviewLanguageCode` is the raw code beside it.
 */
const BASE: GuestReviewBodyInput = {
  reviewText: TURKISH_REVIEW,
  reviewTranslatedText: TURKISH_TRANSLATION,
  reviewContentStatus: 'available',
  reviewLanguageTag: 'tr-Latn-TR',
  reviewLanguageCode: 'tr-TR',
  propertyDefaultReplyLanguage: 'bg-Cyrl',
}

/**
 * The shape production actually ships, today, for every translated review.
 * `google-review-api.adapter.ts:450` hard-codes `languageCode: null`, so the
 * raw code is null and the canonical tag derived from it is null
 * (`reply-language-catalogue.ts:199-201`); the property default is set.
 */
const PRODUCTION_BULGARIAN: GuestReviewBodyInput = {
  reviewText: BULGARIAN_REVIEW,
  reviewTranslatedText: BULGARIAN_TRANSLATION,
  reviewContentStatus: 'available',
  reviewLanguageTag: null,
  reviewLanguageCode: null,
  propertyDefaultReplyLanguage: 'bg-Cyrl',
}

const input = (overrides: Partial<GuestReviewBodyInput> = {}): GuestReviewBodyInput => ({
  ...BASE,
  ...overrides,
})

describe('presentGuestReviewBody', () => {
  describe('when the review language is unknown — the production shape', () => {
    it('keeps the guest words as the body instead of promoting the translation', () => {
      // Review finding (critical): the first rule compared null against
      // `bg-Cyrl`, read "not equivalent" as "foreign", and folded a Bulgarian
      // guest's Bulgarian sentence behind a disclosure under Google's English.
      expect(presentGuestReviewBody(PRODUCTION_BULGARIAN)).toEqual({
        kind: 'original_first',
        body: BULGARIAN_REVIEW,
        // Nothing to label: no language is known for these words.
        bodyLang: null,
        disclosure: {
          label: 'Google translation',
          text: BULGARIAN_TRANSLATION,
          lang: null,
        },
        translationLine: null,
      })
    })

    it('keeps the guest words as the body with no property default either', () => {
      const view = presentGuestReviewBody({
        ...PRODUCTION_BULGARIAN,
        propertyDefaultReplyLanguage: null,
      })

      expect(view).toMatchObject({ kind: 'original_first', body: BULGARIAN_REVIEW })
    })

    it('treats undefined language fields exactly as null ones', () => {
      // Both are optional on `InboxItemDetailResult`, so a caller can hand us
      // `undefined` where the payload simply omitted them.
      const view = presentGuestReviewBody(
        input({
          reviewLanguageTag: undefined,
          reviewLanguageCode: undefined,
          propertyDefaultReplyLanguage: undefined,
        }),
      )

      expect(view).toMatchObject({ kind: 'original_first', body: TURKISH_REVIEW })
    })

    it('treats empty language tags as unknown', () => {
      const view = presentGuestReviewBody(
        input({ reviewLanguageTag: '', reviewLanguageCode: '' }),
      )

      expect(view).toMatchObject({ kind: 'original_first', bodyLang: null })
    })
  })

  describe('when both languages are known', () => {
    it('makes the translation the body when the review is provably foreign', () => {
      expect(presentGuestReviewBody(input())).toEqual({
        kind: 'translation_first',
        body: TURKISH_TRANSLATION,
        // The translation's language is recorded nowhere, so it gets no `lang`.
        bodyLang: null,
        disclosure: {
          // A noun phrase: true whether the disclosure is open or closed.
          label: 'Original in Turkish',
          text: TURKISH_REVIEW,
          lang: 'tr-Latn-TR',
        },
        translationLine: 'Translated from Turkish by Google',
      })
    })

    it('keeps the guest words as the body when the review is in the reply language', () => {
      const view = presentGuestReviewBody(
        input({
          reviewText: BULGARIAN_REVIEW,
          reviewTranslatedText: BULGARIAN_TRANSLATION,
          // `bg-Cyrl-BG` against a `bg-Cyrl` default: one template group.
          reviewLanguageTag: 'bg-Cyrl-BG',
          reviewLanguageCode: 'bg-BG',
        }),
      )

      expect(view).toEqual({
        kind: 'original_first',
        body: BULGARIAN_REVIEW,
        bodyLang: 'bg-Cyrl-BG',
        disclosure: {
          label: 'Google translation',
          text: BULGARIAN_TRANSLATION,
          lang: null,
        },
        // Nothing to attribute: the body is the guest's own words.
        translationLine: null,
      })
    })
  })

  describe('when only part of the evidence is there', () => {
    it('keeps the original first for a known review language and no property default', () => {
      // Plan row 8 as first written promoted the translation here. Amended:
      // with no default there is no reader language to be foreign TO, so
      // nothing is proven and the guest's words keep the body.
      const view = presentGuestReviewBody(input({ propertyDefaultReplyLanguage: null }))

      expect(view).toMatchObject({
        kind: 'original_first',
        body: TURKISH_REVIEW,
        bodyLang: 'tr-Latn-TR',
      })
    })

    it('cannot prove a raw source code differs from the default', () => {
      // `parseCanonicalReplyLanguageTag` needs a `<lang>-<Script>` group, so the
      // raw `tr-TR` canonicalizes to nothing and proves neither sameness nor
      // difference. The raw code still labels the original's language.
      const view = presentGuestReviewBody(input({ reviewLanguageTag: null }))

      expect(view).toMatchObject({
        kind: 'original_first',
        body: TURKISH_REVIEW,
        bodyLang: 'tr-TR',
      })
    })

    it('cannot prove a tag outside the supported groups differs from the default', () => {
      const view = presentGuestReviewBody(
        input({ reviewLanguageTag: 'xx-Zzzz', reviewLanguageCode: null }),
      )

      expect(view.kind).toBe('original_first')
    })

    it('cannot prove anything against a property default that does not canonicalize', () => {
      const view = presentGuestReviewBody(
        input({ propertyDefaultReplyLanguage: 'bg-BG' }),
      )

      expect(view.kind).toBe('original_first')
    })

    it('puts no invalid tag into `lang` or into a sentence', () => {
      // The raw code is served data; a string `Intl.Locale` rejects is dropped
      // rather than written into an attribute — or printed as a language name,
      // which is what `languageDisplayName` would do with it unvalidated.
      const invalid = { reviewLanguageTag: null, reviewLanguageCode: 'not a tag!' }

      expect(presentGuestReviewBody(input(invalid))).toMatchObject({
        kind: 'original_first',
        bodyLang: null,
      })
      expect(
        presentGuestReviewBody(input({ ...invalid, reviewText: null })),
      ).toMatchObject({
        kind: 'translation_only',
        translationLine: 'Translated by Google',
      })
    })
  })

  describe('when there is no translation to arrange', () => {
    it('offers no disclosure when Google served no translation', () => {
      expect(presentGuestReviewBody(input({ reviewTranslatedText: null }))).toEqual({
        kind: 'original_only',
        body: TURKISH_REVIEW,
        bodyLang: 'tr-Latn-TR',
        disclosure: null,
        translationLine: null,
      })
    })

    it('offers no disclosure when the translation is blank', () => {
      const view = presentGuestReviewBody(input({ reviewTranslatedText: '   ' }))

      expect(view).toMatchObject({ kind: 'original_only', disclosure: null })
    })

    it('offers no disclosure when the translation repeats the original', () => {
      // Google returns the source text unchanged when there is nothing to
      // translate; a disclosure onto the sentence already on screen is noise.
      const view = presentGuestReviewBody(
        input({ reviewTranslatedText: `  ${TURKISH_REVIEW}\n` }),
      )

      expect(view).toMatchObject({
        kind: 'original_only',
        // Compared trimmed, rendered untrimmed: the body is the guest's string.
        body: TURKISH_REVIEW,
        disclosure: null,
      })
    })
  })

  describe('when the guest wrote no original text', () => {
    it('prints no body for a genuinely rating-only review', () => {
      expect(
        presentGuestReviewBody(input({ reviewText: null, reviewTranslatedText: null })),
      ).toEqual({ kind: 'no_text' })
      expect(
        presentGuestReviewBody(input({ reviewText: '  ', reviewTranslatedText: ' ' })),
      ).toEqual({ kind: 'no_text' })
    })

    it('prints the translation when it is the only text the payload holds', () => {
      // Review finding: `(Translated by Google) …` with no `(Original)` marker
      // parses to `{ original: null, translation }` (`google-review-comment.ts:59`).
      // The first rule returned `no_text` and the pane showed a review with
      // stars, a date and topic chips and not one word of the text it held.
      const view = presentGuestReviewBody({
        ...PRODUCTION_BULGARIAN,
        reviewText: null,
      })

      expect(view).toEqual({
        kind: 'translation_only',
        body: BULGARIAN_TRANSLATION,
        bodyLang: null,
        disclosure: null,
        // Still marked as machine text; no language is known to name.
        translationLine: 'Translated by Google',
      })
    })

    it('names the source language on a translation-only review when it is known', () => {
      const view = presentGuestReviewBody(input({ reviewText: '   ' }))

      expect(view).toMatchObject({
        kind: 'translation_only',
        body: TURKISH_TRANSLATION,
        translationLine: 'Translated from Turkish by Google',
      })
    })
  })

  describe('when the source withdrew the content', () => {
    it('claims no text and no translation for content the source will not serve', () => {
      // The repository nulls every snippet field on `expired` / `not_found`, but
      // the type allows a stale pair through (a story, a replayed cache entry).
      // Neither text may reach the pane, and the translation least of all.
      for (const status of ['expired', 'not_found'] as const) {
        expect(presentGuestReviewBody(input({ reviewContentStatus: status }))).toEqual({
          kind: 'no_text',
        })
        expect(
          presentGuestReviewBody(
            input({ reviewContentStatus: status, reviewText: null }),
          ),
        ).toEqual({ kind: 'no_text' })
      }
    })

    it('renders a review whose content status the payload never set', () => {
      // `reviewContentStatus` is nullable; null is not a withdrawal.
      const view = presentGuestReviewBody(input({ reviewContentStatus: null }))

      expect(view.kind).toBe('translation_first')
    })
  })
})
