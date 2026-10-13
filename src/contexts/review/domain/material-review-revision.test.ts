import { describe, expect, it } from 'vitest'
import {
  REVIEW_MATERIAL_NORMALIZATION_VERSION,
  compareMaterialReviewRevision,
  computeReviewSourceObservationDigest,
  describeReviewMaterial,
  isGuestEdit,
  normalizeOriginalReviewText,
} from './material-review-revision'

describe('Review material normalization v1', () => {
  it('normalizes Unicode and whitespace without changing letter case or punctuation', () => {
    expect(normalizeOriginalReviewText('  Cafe\u0301\r\n\tstay  ')).toBe('Café stay')
    expect(normalizeOriginalReviewText('Café Stay!')).toBe('Café Stay!')
    expect(normalizeOriginalReviewText(' \n\t ')).toBeNull()
    expect(normalizeOriginalReviewText(null)).toBeNull()
  })

  it('keeps an exact source digest separate from the normalized comparison digest', () => {
    const decomposed = describeReviewMaterial({ rating: 4, text: ' Cafe\u0301  stay ' })
    const normalized = describeReviewMaterial({ rating: 4, text: 'Café stay' })

    expect(decomposed.normalizationVersion).toBe(REVIEW_MATERIAL_NORMALIZATION_VERSION)
    expect(decomposed.sourceDigest).not.toBe(normalized.sourceDigest)
    expect(decomposed.normalizedDigest).toBe(normalized.normalizedDigest)
    expect(decomposed.normalizedText).toBe('Café stay')
  })

  it('versions metadata observations without making metadata part of material comparison', () => {
    const base = {
      rating: 4 as const,
      text: 'Same original words',
      translatedText: 'Same translated words',
      languageCode: 'bg',
      reviewerName: 'Guest',
      reviewerProfilePhotoUrl: null,
      reviewedAt: new Date('2026-08-01T10:00:00.000Z'),
      sourceCreatedAt: new Date('2026-08-01T10:00:00.000Z'),
      sourceUpdatedAt: new Date('2026-08-02T10:00:00.000Z'),
    }

    expect(computeReviewSourceObservationDigest(base)).not.toBe(
      computeReviewSourceObservationDigest({
        ...base,
        translatedText: 'Updated machine translation',
      }),
    )
    expect(
      describeReviewMaterial({ rating: base.rating, text: base.text }).normalizedDigest,
    ).toBe(
      describeReviewMaterial({
        rating: base.rating,
        text: base.text,
      }).normalizedDigest,
    )
  })
})

describe('Material Review Revision comparison', () => {
  it('creates revision one for a first observation', () => {
    expect(
      compareMaterialReviewRevision({
        previous: null,
        incoming: { rating: 5, text: 'Excellent' },
      }),
    ).toMatchObject({
      comparison: 'initial_material_revision',
      materialRevision: 1,
      createsMaterialRevision: true,
    })
  })

  it('does not create a revision for normalized-equivalent original text', () => {
    const previous = describeReviewMaterial({ rating: 5, text: 'Great\n stay' })
    expect(
      compareMaterialReviewRevision({
        previous: { ...previous, materialRevision: 3 },
        incoming: { rating: 5, text: ' Great\tstay ' },
      }),
    ).toMatchObject({
      comparison: 'unchanged',
      materialRevision: 3,
      createsMaterialRevision: false,
    })
  })

  it.each([
    { incoming: { rating: 4 as const, text: 'Same words' }, label: 'rating' },
    { incoming: { rating: 5 as const, text: 'Different words' }, label: 'text' },
  ])('creates one next revision for a material $label change', ({ incoming }) => {
    const previous = describeReviewMaterial({ rating: 5, text: 'Same words' })
    expect(
      compareMaterialReviewRevision({
        previous: { ...previous, materialRevision: 7 },
        incoming,
      }),
    ).toMatchObject({
      comparison: 'material_change',
      materialRevision: 8,
      createsMaterialRevision: true,
    })
  })

  it('adopts a new normalization baseline in shadow without manufacturing an edit', () => {
    expect(
      compareMaterialReviewRevision({
        previous: {
          materialRevision: 2,
          normalizationVersion: 'legacy-unverified-v0',
          sourceDigest: null,
          normalizedDigest: null,
          rating: 3,
          originalText: '  Still\n the same ',
        },
        incoming: { rating: 3, text: 'Still the same' },
      }),
    ).toMatchObject({
      comparison: 'normalization_shadow_match',
      materialRevision: 2,
      createsMaterialRevision: false,
    })
  })

  it('preserves the last material revision when an erased legacy baseline cannot be compared', () => {
    expect(
      compareMaterialReviewRevision({
        previous: {
          materialRevision: 4,
          normalizationVersion: 'legacy-unverified-v0',
          sourceDigest: null,
          normalizedDigest: null,
          rating: null,
          originalText: null,
        },
        incoming: { rating: 2, text: 'Re-observed source' },
      }),
    ).toMatchObject({
      comparison: 'baseline_unavailable',
      materialRevision: 4,
      createsMaterialRevision: false,
    })
  })
})

describe('a guest edit', () => {
  it('is a changed rating or changed text, whichever source epoch it is first seen in', () => {
    const previous = {
      materialRevision: 3,
      normalizationVersion: REVIEW_MATERIAL_NORMALIZATION_VERSION,
      sourceDigest: describeReviewMaterial({ rating: 1, text: 'Dirty room' })
        .sourceDigest,
      normalizedDigest: describeReviewMaterial({ rating: 1, text: 'Dirty room' })
        .normalizedDigest,
      rating: 1 as const,
      originalText: 'Dirty room',
    }
    const comparisonOf = (incoming: { rating: 1 | 5; text: string }) =>
      compareMaterialReviewRevision({ previous, incoming }).comparison

    expect(isGuestEdit(comparisonOf({ rating: 5, text: 'Dirty room' }))).toBe(true)
    expect(isGuestEdit(comparisonOf({ rating: 1, text: 'They fixed it' }))).toBe(true)
    // Whitespace alone is not what the guest wrote.
    expect(isGuestEdit(comparisonOf({ rating: 1, text: ' Dirty  room ' }))).toBe(false)
  })

  it('is no other comparison an observation records', () => {
    // A source-epoch carry of unchanged material is recorded as `unchanged`
    // and still gets the next numbered revision: the number is not the test.
    for (const comparison of [
      'initial_material_revision',
      'unchanged',
      'normalization_shadow_match',
      'baseline_unavailable',
      'backfilled_unverified',
      'out_of_order_ignored',
    ]) {
      expect(isGuestEdit(comparison), comparison).toBe(false)
    }
  })
})
