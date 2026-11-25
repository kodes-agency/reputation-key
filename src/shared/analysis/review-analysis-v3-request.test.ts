import { describe, expect, it } from 'vitest'
import {
  AI_REVIEW_V3_ROUTE_MAX_BYTES,
  REVIEW_ANALYSIS_V3_OPERATION_PROFILE,
  buildReviewAnalysisV3ProviderPayload,
  isCatalogueReviewPropertyContext,
  reviewRedactionsAgree,
  reviewSentencesAreNumberedFromOne,
  reviewSentencesMatchText,
} from './review-analysis-v3-request'
import { REVIEW_ANALYSIS_V3_VERSIONS } from './review-analysis-v3'
import { resolveReviewPropertyContext } from './review-vocabulary-hints'

describe('review-analysis v3 request helpers', () => {
  it('names the operation profile the version set names', () => {
    expect(REVIEW_ANALYSIS_V3_OPERATION_PROFILE).toBe(
      REVIEW_ANALYSIS_V3_VERSIONS.analysisOperation,
    )
  })

  it('bounds a v3 request at twice the route bound of v2 and no more', () => {
    expect(AI_REVIEW_V3_ROUTE_MAX_BYTES).toBe(98_304)
    expect(AI_REVIEW_V3_ROUTE_MAX_BYTES).toBeGreaterThan(65_536)
  })

  describe('reviewSentencesMatchText', () => {
    it('accepts sentences that are the text cut at whitespace', () => {
      expect(
        reviewSentencesMatchText('One. Two! Three', [
          { text: 'One.' },
          { text: 'Two!' },
          { text: 'Three' },
        ]),
      ).toBe(true)
    })

    it('ignores the width of the whitespace and the reviewer markers', () => {
      expect(
        reviewSentencesMatchText('Ask  [PERSON]. Done', [
          { text: 'Ask [PERSON]' },
          { text: '[PERSON].' },
          { text: 'Done' },
        ]),
      ).toBe(true)
    })

    it('refuses a changed, dropped, added or reordered word', () => {
      const text = 'One. Two! Three'
      for (const wrong of [
        [{ text: 'One.' }, { text: 'Too!' }, { text: 'Three' }],
        [{ text: 'One.' }, { text: 'Three' }],
        [{ text: 'One.' }, { text: 'Two!' }, { text: 'Three' }, { text: 'Four' }],
        [{ text: 'Two!' }, { text: 'One.' }, { text: 'Three' }],
        [],
      ]) {
        expect(reviewSentencesMatchText(text, wrong)).toBe(false)
      }
    })
  })

  describe('reviewSentencesAreNumberedFromOne', () => {
    it('wants sentence n at index n - 1', () => {
      expect(reviewSentencesAreNumberedFromOne([])).toBe(true)
      expect(reviewSentencesAreNumberedFromOne([{ number: 1 }, { number: 2 }])).toBe(true)
      expect(reviewSentencesAreNumberedFromOne([{ number: 2 }, { number: 1 }])).toBe(
        false,
      )
      expect(reviewSentencesAreNumberedFromOne([{ number: 0 }, { number: 1 }])).toBe(
        false,
      )
      expect(reviewSentencesAreNumberedFromOne([{ number: 1 }, { number: 3 }])).toBe(
        false,
      )
    })
  })

  describe('reviewRedactionsAgree', () => {
    it('agrees on the same redaction cut into sentences', () => {
      expect(
        reviewRedactionsAgree('Write to [CONTACT] today. Thanks.', [
          'Write to [CONTACT] today.',
          'Thanks.',
        ]),
      ).toBe(true)
    })

    it('counts a marker written into the two sentences it spanned as the one the text has', () => {
      expect(
        reviewRedactionsAgree('Phone [CONTACT] anytime.', [
          'Phone [CONTACT]',
          '[CONTACT] anytime.',
        ]),
      ).toBe(true)
      expect(
        reviewRedactionsAgree('Reach [CONTACT] please. Thanks.', [
          'Reach [CONTACT]',
          '[CONTACT] please.',
          'Thanks.',
        ]),
      ).toBe(true)
    })

    it('disagrees when the text redacted what the sentences left, or the other way', () => {
      expect(
        reviewRedactionsAgree('Phone [CONTACT] anytime.', [
          'Phone +359 888',
          '123 456 anytime.',
        ]),
      ).toBe(false)
      expect(
        reviewRedactionsAgree('Phone number anytime.', ['Phone [CONTACT]', 'anytime.']),
      ).toBe(false)
    })

    it('does not take one kind of placeholder for another', () => {
      expect(reviewRedactionsAgree('At [ADDRESS] now.', ['At [CONTACT] now.'])).toBe(
        false,
      )
    })

    it('does not let a run of one kind hide a different one in between', () => {
      expect(
        reviewRedactionsAgree('[CONTACT] and [CONTACT]', ['[CONTACT] and [ADDRESS]']),
      ).toBe(false)
    })
  })

  describe('isCatalogueReviewPropertyContext', () => {
    it('accepts what the catalogue yields for a category, a missing one included', () => {
      for (const category of [
        'Hotel',
        'Barber shop',
        'Underwater basket weaving',
        null,
      ]) {
        expect(
          isCatalogueReviewPropertyContext(
            resolveReviewPropertyContext(category).propertyContext,
          ),
        ).toBe(true)
      }
    })

    it('refuses a set swapped, a hint added or a category that is not in stored form', () => {
      const hotel = resolveReviewPropertyContext('Hotel').propertyContext
      const barber = resolveReviewPropertyContext('Barber shop').propertyContext

      expect(
        isCatalogueReviewPropertyContext({
          ...hotel,
          vocabularyHints: barber.vocabularyHints,
        }),
      ).toBe(false)
      expect(
        isCatalogueReviewPropertyContext({
          ...hotel,
          vocabularyHints: { ...hotel.vocabularyHints, staff_service: ['extra'] },
        }),
      ).toBe(false)
      expect(
        isCatalogueReviewPropertyContext({ ...hotel, googlePrimaryCategory: ' Hotel ' }),
      ).toBe(false)
      expect(
        isCatalogueReviewPropertyContext({ ...hotel, vocabularyHintSetId: 'lodging-x' }),
      ).toBe(false)
    })
  })

  describe('buildReviewAnalysisV3ProviderPayload', () => {
    it('numbers the sentences from one and copies the context', () => {
      const context = resolveReviewPropertyContext('Hotel').propertyContext
      const payload = buildReviewAnalysisV3ProviderPayload({
        rating: 4,
        languageCode: 'en-Latn',
        propertyContext: context,
        sentences: ['First.', '', 'Third.'],
      })

      expect(payload).toEqual({
        rating: 4,
        languageCode: 'en-Latn',
        propertyContext: context,
        sentences: [
          { number: 1, text: 'First.' },
          { number: 2, text: '' },
          { number: 3, text: 'Third.' },
        ],
      })
      expect(payload.propertyContext).not.toBe(context)
      expect(payload.propertyContext.vocabularyHints).not.toBe(context.vocabularyHints)
    })
  })
})
