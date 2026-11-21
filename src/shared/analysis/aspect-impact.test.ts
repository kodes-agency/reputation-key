import { describe, expect, it } from 'vitest'
import { ASPECT_IMPACT_VERSION, computeAspectImpact } from './aspect-impact'

describe('aspect impact v1', () => {
  it('weights negative mentions by the inverse star rating', () => {
    expect(
      computeAspectImpact({ polarity: 'negative', intensity: -100, rating: 1 }),
    ).toBe(-1)
    expect(
      computeAspectImpact({ polarity: 'negative', intensity: -100, rating: 3 }),
    ).toBe(-0.6)
  })

  it('mirrors the weighting for positive mentions', () => {
    expect(computeAspectImpact({ polarity: 'positive', intensity: 100, rating: 5 })).toBe(
      1,
    )
    expect(computeAspectImpact({ polarity: 'positive', intensity: 100, rating: 3 })).toBe(
      0.6,
    )
  })

  it('gives neutral mentions no impact', () => {
    expect(computeAspectImpact({ polarity: 'neutral', intensity: 19, rating: 1 })).toBe(0)
    expect(computeAspectImpact({ polarity: 'neutral', intensity: -19, rating: 5 })).toBe(
      0,
    )
  })

  it('clamps ratings to the one-to-five-star range', () => {
    expect(
      computeAspectImpact({ polarity: 'negative', intensity: -100, rating: -10 }),
    ).toBe(-1)
    expect(
      computeAspectImpact({ polarity: 'negative', intensity: -100, rating: 10 }),
    ).toBe(-0.2)
    expect(
      computeAspectImpact({ polarity: 'positive', intensity: 100, rating: -10 }),
    ).toBe(0.2)
    expect(
      computeAspectImpact({ polarity: 'positive', intensity: 100, rating: 10 }),
    ).toBe(1)
  })

  it('publishes the computation version', () => {
    expect(ASPECT_IMPACT_VERSION).toBe('aspect-impact-v1')
  })
})
