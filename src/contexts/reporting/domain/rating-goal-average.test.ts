import { describe, expect, it } from 'vitest'
import { ratio } from './rating-goal-numbers'
import {
  AUTOMATIC_AVERAGE_CAP_TENTHS,
  automaticAverage,
  bestEvidence,
  goalRange,
  halfwayTenths,
  ownAverageTenths,
  reachableAt,
} from './rating-goal-average'

const month = (sum: number, count: number) => ({
  year: 2026,
  month: 8,
  average: ratio(sum, count),
  reviewCount: count,
})
const year = (sum: number, count: number) => ({
  year: 2024,
  average: ratio(sum, count),
  reviewCount: count,
})

describe('halfway between the shown number and five stars', () => {
  it.each([
    [25, 38],
    [36, 43],
    [39, 45],
    [40, 45],
    [42, 46],
    [44, 47],
    [45, 48],
    [46, 48],
  ])('plans %i at %i, rounded half up', (shown, halfway) => {
    expect(halfwayTenths(shown)).toBe(halfway)
  })
})

describe('the best evidence', () => {
  it('is none without a month or a year of ten reviews', () => {
    expect(bestEvidence(null, null)).toBeNull()
  })

  it('takes the year when its tenth is higher than the month’s', () => {
    expect(bestEvidence(month(43, 10), year(116, 26))).toEqual({
      kind: 'best_year',
      year: 2024,
      tenths: 45,
    })
  })

  it('gives a tie on the tenth to the month, the more recent evidence', () => {
    expect(bestEvidence(month(52, 11), year(47, 10))).toEqual({
      kind: 'best_month',
      year: 2026,
      month: 8,
      tenths: 47,
    })
  })
})

describe('the automatic planned average', () => {
  it('takes the evidence when it reaches halfway (Harborline: best year 4.5 at 3.9)', () => {
    const evidence = { kind: 'best_year', year: 2024, tenths: 45 } as const
    expect(automaticAverage(39, evidence)).toEqual({ tenths: 45, source: 'best_year' })
  })

  it('takes halfway when the evidence is lower (Olive Tree: 4.2 at 4.2)', () => {
    const evidence = { kind: 'best_year', year: 2025, tenths: 42 } as const
    expect(automaticAverage(42, evidence)).toEqual({ tenths: 46, source: 'halfway' })
  })

  it('takes halfway without any evidence', () => {
    expect(automaticAverage(25, null)).toEqual({ tenths: 38, source: 'halfway' })
  })

  it('never plans above 4.8, whatever the evidence says', () => {
    const evidence = { kind: 'best_month', year: 2026, month: 5, tenths: 50 } as const
    expect(AUTOMATIC_AVERAGE_CAP_TENTHS).toBe(48)
    expect(automaticAverage(45, evidence)).toEqual({ tenths: 48, source: 'best_month' })
  })
})

describe('an average the manager types', () => {
  it('is used as a tenth when it lies from two steps above the shown number to 5.0', () => {
    expect(ownAverageTenths(39, 4.5)).toEqual({ tenths: 45, clamped: false })
    expect(ownAverageTenths(39, 4.1)).toEqual({ tenths: 41, clamped: false })
  })

  it('is clamped and reported below the floor and above five stars', () => {
    expect(ownAverageTenths(39, 4.0)).toEqual({ tenths: 41, clamped: true })
    expect(ownAverageTenths(39, 9.9)).toEqual({ tenths: 50, clamped: true })
  })

  it('falls back to the floor when nothing readable was typed', () => {
    expect(ownAverageTenths(42, null)).toEqual({ tenths: 44, clamped: true })
    expect(ownAverageTenths(42, Number.NaN)).toEqual({ tenths: 44, clamped: true })
  })
})

describe('which goals an average reaches', () => {
  it('reaches a tenth above the shown one when the average clears it by a tenth', () => {
    expect(reachableAt(39, 44, 45)).toBe(true)
    expect(reachableAt(39, 45, 45)).toBe(false)
    expect(reachableAt(39, 39, 45)).toBe(false)
  })

  it('never reaches 5.0', () => {
    expect(reachableAt(48, 50, 50)).toBe(false)
  })

  it('runs from the tenth above what is earned to the highest the average reaches', () => {
    expect(goalRange(39, 39, 45)).toEqual({ minTenths: 40, maxTenths: 44 })
    expect(goalRange(39, 40, 45)).toEqual({ minTenths: 41, maxTenths: 44 })
    expect(goalRange(46, 46, 50)).toEqual({ minTenths: 47, maxTenths: 49 })
  })

  it('keeps the lowest goal when the average reaches nothing higher', () => {
    expect(goalRange(46, 46, 48)).toEqual({ minTenths: 47, maxTenths: 47 })
  })
})
