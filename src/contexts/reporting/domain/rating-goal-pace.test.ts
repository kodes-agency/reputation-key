import { describe, expect, it } from 'vitest'
import { ratio } from './rating-goal-numbers'
import {
  MAX_PACE_PER_WEEK,
  MIN_PACE_PER_WEEK,
  currentPacePerWeek,
  isValidPace,
  paceSuggestions,
  perDay,
  perMonth,
  surgeCaution,
} from './rating-goal-pace'

describe('the current pace', () => {
  it('is the reviews of the last 28 days per week', () => {
    expect(currentPacePerWeek(28)).toEqual(ratio(7, 1))
    // Beta property A: one review in 28 days is 0.25 a week.
    expect(currentPacePerWeek(1)).toEqual(ratio(1, 4))
    expect(currentPacePerWeek(0)).toEqual(ratio(0, 1))
  })
})

describe('the three suggested paces', () => {
  it('rounds 1.5 times seven half up to eleven (the worked example said ten informally)', () => {
    expect(paceSuggestions(28)).toEqual({ steady: 7, faster: 11, push: 14 })
  })

  it('floors a slow Property at one, two and three a week', () => {
    expect(paceSuggestions(1)).toEqual({ steady: 1, faster: 2, push: 3 })
    expect(paceSuggestions(0)).toEqual({ steady: 1, faster: 2, push: 3 })
  })

  it('keeps the three strictly increasing where rounding would tie them', () => {
    // p = 1.5: Steady round(1.5) = 2, Faster round(2.25) = 2, Push 3.
    expect(paceSuggestions(6)).toEqual({ steady: 2, faster: 3, push: 4 })
  })

  it('stays inside the pace a goal may store', () => {
    expect(paceSuggestions(4000)).toEqual({ steady: 198, faster: 199, push: 200 })
  })
})

describe('a pace per month and per day', () => {
  it('converts a weekly pace at 52 weeks over 12 months, rounded half up', () => {
    expect(perMonth(11)).toBe(48) // 47.67
    expect(perMonth(3)).toBe(13) // 13.0
    expect(perMonth(6)).toBe(26) // 26.0
    expect(perMonth(9)).toBe(39) // 39.0
  })

  it('converts a weekly pace to one decimal a day, rounded half up', () => {
    expect(perDay(11)).toBe(1.6) // 1.571
    expect(perDay(7)).toBe(1)
    expect(perDay(1)).toBe(0.1) // 0.143
    expect(perDay(200)).toBe(28.6) // 28.571
  })
})

describe('a custom pace', () => {
  it('accepts whole numbers from one to two hundred', () => {
    expect([MIN_PACE_PER_WEEK, MAX_PACE_PER_WEEK]).toEqual([1, 200])
    expect(isValidPace(1)).toBe(true)
    expect(isValidPace(200)).toBe(true)
    expect(isValidPace(0)).toBe(false)
    expect(isValidPace(201)).toBe(false)
    expect(isValidPace(2.5)).toBe(false)
  })

  it('cautions above twice the current pace, never below twice one a week', () => {
    expect(surgeCaution(14, 28)).toBe(false)
    expect(surgeCaution(15, 28)).toBe(true)
    // Current pace 0.25 a week: the floor is 2 × 1.
    expect(surgeCaution(2, 1)).toBe(false)
    expect(surgeCaution(3, 1)).toBe(true)
  })
})
