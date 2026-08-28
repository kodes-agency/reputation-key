import { describe, expect, it } from 'vitest'
import {
  emptyPortalLifetimeValues,
  portalLifetimeFactForMetric,
} from '../domain/portal-lifetime-aggregate'
import {
  applyPortalLifetimeChangeSet,
  type PortalLifetimeStoredRow,
} from './portal-lifetime-aggregate-store'

const rating = (stars: number) =>
  portalLifetimeFactForMetric({ metricKey: 'portal.rating', value: stars })!

function withRating(
  stars: number,
  sealedThroughLocalDate: string | null = null,
): PortalLifetimeStoredRow {
  const contribution = rating(stars).contribution
  return {
    values: contribution,
    sealedValues:
      sealedThroughLocalDate === null ? emptyPortalLifetimeValues() : contribution,
    sealedThroughLocalDate,
    projectionRevision: 7,
  }
}

describe('applyPortalLifetimeChangeSet', () => {
  it('moves a correction across the sealed boundary without resurrecting old stars', () => {
    const corrected = applyPortalLifetimeChangeSet(withRating(2, '2026-08-01'), [
      {
        fact: rating(2),
        multiplier: -1,
        propertyLocalDate: '2026-07-01',
      },
      {
        fact: rating(5),
        multiplier: 1,
        propertyLocalDate: '2026-08-02',
      },
    ])

    expect(corrected.values).toMatchObject({
      privateRatingCount: 1,
      privateRatingSum: 5,
      privateRating2Count: 0,
      privateRating5Count: 1,
    })
    expect(corrected.sealedValues).toEqual(emptyPortalLifetimeValues())
    expect(corrected.projectionRevision).toBe(8)
  })

  it('applies a pre-purge withdrawal to both lifetime and sealed baselines', () => {
    const withdrawn = applyPortalLifetimeChangeSet(withRating(3, '2026-08-01'), [
      {
        fact: rating(3),
        multiplier: -1,
        propertyLocalDate: '2026-07-31',
      },
    ])

    expect(withdrawn.values).toEqual(emptyPortalLifetimeValues())
    expect(withdrawn.sealedValues).toEqual(emptyPortalLifetimeValues())
  })

  it('does not alter the sealed baseline for a retained-window fact', () => {
    const scan = portalLifetimeFactForMetric({
      metricKey: 'portal.qualified_scan',
      value: 1,
    })!
    const next = applyPortalLifetimeChangeSet(
      {
        values: emptyPortalLifetimeValues(),
        sealedValues: emptyPortalLifetimeValues(),
        sealedThroughLocalDate: '2026-08-01',
        projectionRevision: 1,
      },
      [
        {
          fact: scan,
          multiplier: 1,
          propertyLocalDate: '2026-08-01',
        },
      ],
    )

    expect(next.values.qualifiedScanCount).toBe(1)
    expect(next.sealedValues.qualifiedScanCount).toBe(0)
  })
})
