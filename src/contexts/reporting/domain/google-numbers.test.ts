import { describe, expect, it } from 'vitest'
import { googleNumbersView, ratingGoalOffered } from './google-numbers'

const NOW = new Date('2026-10-15T12:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000

const snapshot = (overrides: Partial<Parameters<typeof googleNumbersView>[0]> = {}) => ({
  reviewCount: 812,
  averageRating: 4.300000190734863,
  verifiedAt: new Date(NOW.getTime() - 2 * HOUR_MS),
  ...overrides,
})

describe('googleNumbersView', () => {
  it('shows Google’s own tenth and count, current while it is a day old at most', () => {
    // Arrange
    const fresh = snapshot({ verifiedAt: new Date(NOW.getTime() - 24 * HOUR_MS) })

    // Act
    const view = googleNumbersView(fresh, true, NOW)

    // Assert
    expect(view).toEqual({
      shows: 4.3,
      reviewCount: 812,
      asOf: fresh.verifiedAt.toISOString(),
      current: true,
    })
  })

  it('keeps the last number with its date once it is more than a day old', () => {
    // Arrange
    const stale = snapshot({ verifiedAt: new Date(NOW.getTime() - 24 * HOUR_MS - 1) })

    // Act
    const view = googleNumbersView(stale, true, NOW)

    // Assert
    expect(view).toMatchObject({ shows: 4.3, reviewCount: 812, current: false })
    expect(view?.asOf).toBe(stale.verifiedAt.toISOString())
  })

  it('is not current while the Google binding is not active, however fresh the number', () => {
    // Act
    const view = googleNumbersView(snapshot(), false, NOW)

    // Assert
    expect(view).toMatchObject({ shows: 4.3, current: false })
  })

  it('is nothing when Google never sent numbers for the current binding', () => {
    // Act
    const view = googleNumbersView(null, true, NOW)

    // Assert
    expect(view).toBeNull()
  })

  it('shows no rating when Google has a count and no average', () => {
    // Act
    const view = googleNumbersView(
      snapshot({ reviewCount: 0, averageRating: null }),
      true,
      NOW,
    )

    // Assert
    expect(view).toMatchObject({ shows: null, reviewCount: 0, current: true })
  })

  it('strips the float32 artefact Google’s average arrives with', () => {
    // Act
    const view = googleNumbersView(
      snapshot({ averageRating: 3.9000000953674316 }),
      true,
      NOW,
    )

    // Assert
    expect(view?.shows).toBe(3.9)
  })
})

describe('ratingGoalOffered', () => {
  it('offers a goal to an active Property Google counts ten reviews for, current or not', () => {
    expect(ratingGoalOffered({ propertyActive: true, googleReviewCount: 10 })).toBe(true)
    expect(ratingGoalOffered({ propertyActive: true, googleReviewCount: 812 })).toBe(true)
  })

  it('offers none below ten Google reviews, or without Google’s numbers', () => {
    expect(ratingGoalOffered({ propertyActive: true, googleReviewCount: 9 })).toBe(false)
    expect(ratingGoalOffered({ propertyActive: true, googleReviewCount: null })).toBe(
      false,
    )
  })

  it('offers none to a Property that is not active', () => {
    expect(ratingGoalOffered({ propertyActive: false, googleReviewCount: 812 })).toBe(
      false,
    )
  })
})
