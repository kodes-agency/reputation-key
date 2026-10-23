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

  describe('a baseline stored before the parser knew a provider envelope', () => {
    // What the parser stored on 2026-10-23 when Google first sent the
    // original-first envelope: the whole envelope as the guest's text.
    const glued = 'Ок\n\n(Translated by Google)\nOk'
    const previous = {
      ...describeReviewMaterial({ rating: 1, text: glued }),
      materialRevision: 2,
      originalText: glued,
      rereadOriginalText: 'Ок',
    }

    it('adopts the split text without manufacturing a guest edit', () => {
      const result = compareMaterialReviewRevision({
        previous,
        incoming: { rating: 1, text: 'Ок' },
      })

      expect(result).toMatchObject({
        comparison: 'normalization_shadow_match',
        materialRevision: 2,
        createsMaterialRevision: false,
      })
      expect(isGuestEdit(result.comparison)).toBe(false)
    })

    it.each([
      { incoming: { rating: 2 as const, text: 'Ок' }, label: 'rating' },
      { incoming: { rating: 1 as const, text: 'Не е добре' }, label: 'text' },
    ])('still counts a real $label edit as one', ({ incoming }) => {
      expect(compareMaterialReviewRevision({ previous, incoming })).toMatchObject({
        comparison: 'material_change',
        materialRevision: 3,
        createsMaterialRevision: true,
      })
    })

    it('compares as before when the stored text rereads as itself', () => {
      expect(
        compareMaterialReviewRevision({
          previous: { ...previous, rereadOriginalText: glued },
          incoming: { rating: 1, text: 'Ок' },
        }),
      ).toMatchObject({ comparison: 'material_change', materialRevision: 3 })
    })

    it('adopts the split text when the stored text was already split in place', () => {
      expect(
        compareMaterialReviewRevision({
          previous: { ...previous, originalText: 'Ок', rereadOriginalText: 'Ок' },
          incoming: { rating: 1, text: 'Ок' },
        }),
      ).toMatchObject({
        comparison: 'normalization_shadow_match',
        materialRevision: 2,
        createsMaterialRevision: false,
      })
    })

    it('still counts a guest who removed their words when the stored text is gone', () => {
      expect(
        compareMaterialReviewRevision({
          previous: { ...previous, originalText: null, rereadOriginalText: null },
          incoming: { rating: 1, text: null },
        }),
      ).toMatchObject({ comparison: 'material_change', materialRevision: 3 })
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

describe('an unmoved Google updateTime', () => {
  // Google changed how it wraps translated text on 2026-10-23 and did not move
  // updateTime. A rating or text that differs while the provider's own edit
  // clock stands still is Google restating the review, not the guest editing.
  const UPDATED = new Date('2026-10-20T08:30:00.000Z')
  const previous = {
    ...describeReviewMaterial({ rating: 5, text: 'Same words' }),
    materialRevision: 4,
  }
  const incomingEdit = { rating: 5 as const, text: 'Same words, wrapped again' }
  const at = (storedMs: number | null, incomingMs: number | null) => ({
    stored: storedMs === null ? null : new Date(storedMs),
    incoming: incomingMs === null ? null : new Date(incomingMs),
  })

  it.each([
    { incoming: { rating: 4 as const, text: 'Same words' }, label: 'rating' },
    { incoming: incomingEdit, label: 'text' },
  ])(
    'keeps the revision and adopts the incoming digests when the $label differs',
    ({ incoming }) => {
      const result = compareMaterialReviewRevision({
        previous,
        incoming,
        providerUpdateTime: { stored: UPDATED, incoming: new Date(UPDATED.getTime()) },
      })

      expect(result).toMatchObject({
        comparison: 'provider_restatement',
        materialRevision: 4,
        createsMaterialRevision: false,
        normalizedDigest: describeReviewMaterial(incoming).normalizedDigest,
        sourceDigest: describeReviewMaterial(incoming).sourceDigest,
      })
      expect(isGuestEdit(result.comparison)).toBe(false)
    },
  )

  it('still counts a change when Google moved updateTime by one millisecond', () => {
    const result = compareMaterialReviewRevision({
      previous,
      incoming: incomingEdit,
      providerUpdateTime: at(UPDATED.getTime(), UPDATED.getTime() + 1),
    })

    expect(result).toMatchObject({
      comparison: 'material_change',
      materialRevision: 5,
      createsMaterialRevision: true,
    })
    expect(isGuestEdit(result.comparison)).toBe(true)
  })

  it('leaves an older updateTime to the repository, which ignores it as out of order', () => {
    expect(
      compareMaterialReviewRevision({
        previous,
        incoming: incomingEdit,
        providerUpdateTime: at(UPDATED.getTime(), UPDATED.getTime() - 1),
      }),
    ).toMatchObject({ comparison: 'material_change', materialRevision: 5 })
  })

  it.each([
    { label: 'the stored time is missing', times: at(null, UPDATED.getTime()) },
    { label: 'Google reported no time', times: at(UPDATED.getTime(), null) },
    { label: 'neither time is known', times: at(null, null) },
    { label: 'no times are passed', times: undefined },
  ])('is not a restatement when $label', ({ times }) => {
    expect(
      compareMaterialReviewRevision({
        previous,
        incoming: incomingEdit,
        ...(times === undefined ? {} : { providerUpdateTime: times }),
      }),
    ).toMatchObject({
      comparison: 'material_change',
      materialRevision: 5,
      createsMaterialRevision: true,
    })
  })

  it('compares times at the millisecond Google and Postgres keep', () => {
    expect(
      compareMaterialReviewRevision({
        previous,
        incoming: incomingEdit,
        providerUpdateTime: {
          stored: new Date('2026-10-20T08:30:00.123456789Z'),
          incoming: new Date('2026-10-20T08:30:00.123999999Z'),
        },
      }),
    ).toMatchObject({ comparison: 'provider_restatement', materialRevision: 4 })
    expect(
      compareMaterialReviewRevision({
        previous,
        incoming: incomingEdit,
        providerUpdateTime: {
          stored: new Date('2026-10-20T08:30:00.123999999Z'),
          incoming: new Date('2026-10-20T08:30:00.124000001Z'),
        },
      }),
    ).toMatchObject({ comparison: 'material_change', materialRevision: 5 })
  })

  it('applies to a baseline stored before material digests existed', () => {
    const legacy = {
      materialRevision: 2,
      normalizationVersion: 'legacy-unverified-v0',
      sourceDigest: null,
      normalizedDigest: null,
      rating: 3 as const,
      originalText: 'Still the same',
    }
    expect(
      compareMaterialReviewRevision({
        previous: legacy,
        incoming: { rating: 3, text: 'Wrapped differently' },
        providerUpdateTime: { stored: UPDATED, incoming: new Date(UPDATED.getTime()) },
      }),
    ).toMatchObject({
      comparison: 'provider_restatement',
      materialRevision: 2,
      createsMaterialRevision: false,
    })
    expect(
      compareMaterialReviewRevision({
        previous: legacy,
        incoming: { rating: 3, text: 'Wrapped differently' },
        providerUpdateTime: at(UPDATED.getTime(), UPDATED.getTime() + 1),
      }),
    ).toMatchObject({ comparison: 'material_change', materialRevision: 3 })
  })

  it('does not touch the other outcomes, whatever the times say', () => {
    const equal = { stored: UPDATED, incoming: new Date(UPDATED.getTime()) }
    expect(
      compareMaterialReviewRevision({
        previous: null,
        incoming: incomingEdit,
        providerUpdateTime: equal,
      }),
    ).toMatchObject({ comparison: 'initial_material_revision', materialRevision: 1 })
    expect(
      compareMaterialReviewRevision({
        previous,
        incoming: { rating: 5, text: ' Same  words ' },
        providerUpdateTime: equal,
      }),
    ).toMatchObject({ comparison: 'unchanged', materialRevision: 4 })
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
        providerUpdateTime: equal,
      }),
    ).toMatchObject({ comparison: 'baseline_unavailable', materialRevision: 4 })
  })

  it('leaves the translation-envelope reread to win, as normalization_shadow_match', () => {
    const glued = 'Ок\n\n(Translated by Google)\nOk'
    const result = compareMaterialReviewRevision({
      previous: {
        ...describeReviewMaterial({ rating: 1, text: glued }),
        materialRevision: 2,
        originalText: glued,
        rereadOriginalText: 'Ок',
      },
      incoming: { rating: 1, text: 'Ок' },
      providerUpdateTime: { stored: UPDATED, incoming: new Date(UPDATED.getTime()) },
    })

    expect(result).toMatchObject({
      comparison: 'normalization_shadow_match',
      materialRevision: 2,
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
      'provider_restatement',
      'baseline_unavailable',
      'backfilled_unverified',
      'out_of_order_ignored',
    ]) {
      expect(isGuestEdit(comparison), comparison).toBe(false)
    }
  })
})
