import { describe, expect, it } from 'vitest'
import {
  applyPortalLifetimeContribution,
  assertPortalLifetimeValues,
  emptyPortalLifetimeValues,
  isEmptyPortalLifetimeContribution,
  portalLifetimeFactForMetric,
  sumPortalLifetimeContributions,
} from './portal-lifetime-aggregate'

describe('portalLifetimeFactForMetric', () => {
  it('counts only the qualified scan and ignores the legacy raw scan', () => {
    expect(
      portalLifetimeFactForMetric({
        metricKey: 'portal.qualified_scan',
        value: 1,
      }),
    ).toMatchObject({ contribution: { qualifiedScanCount: 1 } })
    expect(portalLifetimeFactForMetric({ metricKey: 'portal.scan', value: 1 })).toBeNull()
  })

  it.each([1, 2, 3, 4, 5])(
    'keeps an exact private-rating count, sum, and %i-star bucket',
    (stars) => {
      const fact = portalLifetimeFactForMetric({
        metricKey: 'portal.rating',
        value: stars,
      })

      expect(fact).toMatchObject({
        contribution: {
          privateRatingCount: 1,
          privateRatingSum: stars,
          [`privateRating${stars}Count`]: 1,
        },
      })
    },
  )

  it('does not double count the governed count/average rating fanout', () => {
    expect(
      portalLifetimeFactForMetric({ metricKey: 'portal.rating_count', value: 1 }),
    ).toBeNull()
    expect(
      portalLifetimeFactForMetric({ metricKey: 'portal.rating_average', value: 4 }),
    ).toBeNull()
  })

  it('keeps Google and secondary destination selections distinct', () => {
    expect(
      portalLifetimeFactForMetric({
        metricKey: 'portal.review_link_click',
        value: 1,
        destinationKind: 'google_review',
      }),
    ).toMatchObject({
      destinationKind: 'google_review',
      contribution: { googleReviewSelectionCount: 1 },
    })
    expect(
      portalLifetimeFactForMetric({
        metricKey: 'portal.review_link_click',
        value: 1,
        destinationKind: 'secondary_link',
      }),
    ).toMatchObject({
      destinationKind: 'secondary_link',
      contribution: { secondaryLinkSelectionCount: 1 },
    })
  })

  it('counts private feedback without retaining a destination', () => {
    expect(
      portalLifetimeFactForMetric({
        metricKey: 'portal.feedback',
        value: 1,
      }),
    ).toMatchObject({
      destinationKind: null,
      contribution: { privateFeedbackCount: 1 },
    })
  })

  it('never blends Google public-reputation readings into private Portal ratings', () => {
    expect(
      portalLifetimeFactForMetric({ metricKey: 'property.review', value: 5 }),
    ).toBeNull()
  })

  it.each([
    { metricKey: 'portal.qualified_scan' as const, value: 2 },
    {
      metricKey: 'portal.qualified_scan' as const,
      value: 1,
      destinationKind: 'google_review' as const,
    },
    { metricKey: 'portal.rating' as const, value: 0 },
    { metricKey: 'portal.rating' as const, value: 4.5 },
    {
      metricKey: 'portal.rating' as const,
      value: 4,
      destinationKind: 'secondary_link' as const,
    },
    { metricKey: 'portal.feedback' as const, value: 0 },
    {
      metricKey: 'portal.feedback' as const,
      value: 1,
      destinationKind: 'google_review' as const,
    },
    {
      metricKey: 'portal.review_link_click' as const,
      value: 2,
      destinationKind: 'google_review' as const,
    },
    { metricKey: 'portal.review_link_click' as const, value: 1 },
  ])('rejects malformed eligible facts instead of silently skewing totals', (input) => {
    expect(() => portalLifetimeFactForMetric(input)).toThrow(
      'Portal lifetime metric fact is invalid',
    )
  })
})

describe('Portal lifetime correction arithmetic', () => {
  it('recognizes only an all-zero contribution as empty', () => {
    expect(isEmptyPortalLifetimeContribution(emptyPortalLifetimeValues())).toBe(true)
    expect(
      isEmptyPortalLifetimeContribution({
        ...emptyPortalLifetimeValues(),
        secondaryLinkSelectionCount: 1,
      }),
    ).toBe(false)
  })

  it.each([
    {
      values: { ...emptyPortalLifetimeValues(), qualifiedScanCount: 0.5 },
      reason: 'unsafe numeric values',
    },
    {
      values: { ...emptyPortalLifetimeValues(), privateRatingCount: 1 },
      reason: 'rating count without a star bucket',
    },
    {
      values: {
        ...emptyPortalLifetimeValues(),
        privateRatingCount: 2,
        privateRatingSum: 1,
        privateRating1Count: 2,
      },
      reason: 'rating sum below its count',
    },
    {
      values: {
        ...emptyPortalLifetimeValues(),
        privateRatingCount: 1,
        privateRatingSum: 6,
        privateRating5Count: 1,
      },
      reason: 'rating sum above the five-star ceiling',
    },
  ])('rejects $reason', ({ values }) => {
    expect(() => assertPortalLifetimeValues(values, 'invalid lifetime total')).toThrow(
      'invalid lifetime total',
    )
  })

  it('applies a rating correction as one atomic negative/positive delta', () => {
    const original = portalLifetimeFactForMetric({
      metricKey: 'portal.rating',
      value: 2,
    })!
    const replacement = portalLifetimeFactForMetric({
      metricKey: 'portal.rating',
      value: 5,
    })!
    const first = applyPortalLifetimeContribution(
      emptyPortalLifetimeValues(),
      original.contribution,
    )
    const corrected = applyPortalLifetimeContribution(
      first,
      sumPortalLifetimeContributions(replacement.contribution, original.contribution, -1),
    )

    expect(corrected).toMatchObject({
      privateRatingCount: 1,
      privateRatingSum: 5,
      privateRating2Count: 0,
      privateRating5Count: 1,
    })
  })

  it('applies a withdrawal without allowing an impossible negative aggregate', () => {
    const scan = portalLifetimeFactForMetric({
      metricKey: 'portal.qualified_scan',
      value: 1,
    })!
    const recorded = applyPortalLifetimeContribution(
      emptyPortalLifetimeValues(),
      scan.contribution,
    )

    expect(
      applyPortalLifetimeContribution(
        recorded,
        sumPortalLifetimeContributions(
          emptyPortalLifetimeValues(),
          scan.contribution,
          -1,
        ),
      ),
    ).toEqual(emptyPortalLifetimeValues())
    expect(() =>
      applyPortalLifetimeContribution(
        emptyPortalLifetimeValues(),
        sumPortalLifetimeContributions(
          emptyPortalLifetimeValues(),
          scan.contribution,
          -1,
        ),
      ),
    ).toThrow('Portal lifetime aggregate would become invalid')
  })
})
