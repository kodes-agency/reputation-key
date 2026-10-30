import { describe, expect, it } from 'vitest'
import { meanOf, prf, ratio, rounded, tally } from './review-analysis-v3-stats'

describe('ratio', () => {
  it('is null over nothing, never 0 and never 1', () => {
    expect(ratio(0, 0)).toBeNull()
    expect(ratio(3, 0)).toBeNull()
  })

  it('divides otherwise', () => {
    expect(ratio(19, 20)).toBe(0.95)
    expect(ratio(0, 5)).toBe(0)
  })
})

describe('meanOf', () => {
  it('skips the values that do not exist', () => {
    expect(meanOf([1, null, 0.5])).toBe(0.75)
  })

  it('is null when no value exists', () => {
    expect(meanOf([])).toBeNull()
    expect(meanOf([null, null])).toBeNull()
  })
})

describe('prf', () => {
  it('computes precision, recall and F1 from counts', () => {
    const scores = prf(6, 2, 4)

    expect(scores.precision).toBe(0.75)
    expect(scores.recall).toBe(0.6)
    expect(scores.f1).toBeCloseTo(12 / 18, 12)
  })

  it('scores 0 when something was predicted or expected and nothing matched', () => {
    expect(prf(0, 3, 0).f1).toBe(0)
    expect(prf(0, 0, 2).f1).toBe(0)
    expect(prf(0, 3, 0).recall).toBeNull()
  })

  it('has no score when there was nothing to match', () => {
    expect(prf(0, 0, 0)).toMatchObject({ precision: null, recall: null, f1: null })
  })
})

describe('tally', () => {
  it('counts keys and orders them', () => {
    expect(tally(['b', 'a', 'b'])).toEqual({ a: 1, b: 2 })
    expect(Object.keys(tally(['b', 'a', 'b']))).toEqual(['a', 'b'])
  })
})

describe('rounded', () => {
  it('rounds for display and keeps null', () => {
    expect(rounded(2 / 3)).toBe(0.6667)
    expect(rounded(0.123456, 2)).toBe(0.12)
    expect(rounded(null)).toBeNull()
  })
})
