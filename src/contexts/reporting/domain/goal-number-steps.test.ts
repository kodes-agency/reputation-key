import { describe, expect, it } from 'vitest'
import {
  goalStepAtOrAbove,
  goalStepDown,
  goalStepUp,
  ownNumberNote,
  type ExactCount,
} from './goal-number-steps'

/** A decimal such as 20.1 as an exact count, without a float. */
const decimal = (text: string): ExactCount => {
  const [whole = '0', fraction = ''] = text.split('.')
  return {
    num: BigInt(`${whole}${fraction}`),
    den: 10n ** BigInt(fraction.length),
  }
}

describe('goal number steps', () => {
  it('one grid for rounding: whole under 30, fives to 100, tens to 500, fifties above', () => {
    const cases: ReadonlyArray<readonly [string, number]> = [
      ['0.2', 1],
      ['9', 9],
      ['20.1', 21],
      ['29', 29],
      ['29.3', 30],
      ['30', 30],
      ['34.29', 35],
      ['37.71', 40],
      ['49.3', 50],
      ['100', 100],
      ['100.2', 110],
      ['499.1', 500],
      ['500', 500],
      ['500.5', 550],
      ['1234.5', 1250],
    ]

    for (const [value, step] of cases) {
      expect(goalStepAtOrAbove(decimal(value)), value).toBe(step)
    }
  })

  it('rounds an exact third up, as no float could', () => {
    // 103 / 3 = 34.333… : a float sum can land on either side of a step.
    expect(goalStepAtOrAbove({ num: 103n, den: 3n })).toBe(35)
    expect(goalStepAtOrAbove({ num: 105n, den: 3n })).toBe(35)
    expect(goalStepAtOrAbove({ num: 0n, den: 1n })).toBe(1)
  })

  it('up is the next step', () => {
    const cases: ReadonlyArray<readonly [number, number]> = [
      [0, 1],
      [12, 13],
      [28, 29],
      [29, 30],
      [30, 35],
      [37, 40],
      [97, 100],
      [100, 110],
      [495, 500],
      [500, 550],
      [550, 600],
    ]

    for (const [value, next] of cases) {
      expect(goalStepUp(value), String(value)).toBe(next)
    }
  })

  it('down is the step before; null at 1', () => {
    const cases: ReadonlyArray<readonly [number, number | null]> = [
      [0, null],
      [1, null],
      [2, 1],
      [29, 28],
      [30, 29],
      [31, 30],
      [35, 30],
      [37, 35],
      [100, 95],
      [101, 100],
      [110, 100],
      [500, 490],
      [501, 500],
      [550, 500],
      [1_000_000, 999_950],
    ]

    for (const [value, before] of cases) {
      expect(goalStepDown(value), String(value)).toBe(before)
    }
    // A typed number off the grid steps onto it either way.
    expect([goalStepDown(37), goalStepUp(37)]).toEqual([35, 40])
  })

  it('steps only from a whole number', () => {
    expect(() => goalStepDown(-1)).toThrow(RangeError)
    expect(() => goalStepDown(2.5)).toThrow(RangeError)
    expect(() => goalStepDown(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError)
  })
})

describe('own number note', () => {
  // G1: the usual for a 30-day November is 16 / 14 × 30 = 240 / 7, about 34.29.
  const NOVEMBER_USUAL: ExactCount = { num: 240n, den: 7n }

  it('says about how many times the usual a number three times it or more is', () => {
    // 120 / 34.29 = 3.5, half up.
    expect(ownNumberNote(120, NOVEMBER_USUAL)).toEqual({ kind: 'times', times: 4 })
    // 103 is 3.004 times: three times, just.
    expect(ownNumberNote(103, NOVEMBER_USUAL)).toEqual({ kind: 'times', times: 3 })
    // 119 is 3.47 times.
    expect(ownNumberNote(119, NOVEMBER_USUAL)).toEqual({ kind: 'times', times: 3 })
    expect(ownNumberNote(102, { num: 34n, den: 1n })).toEqual({ kind: 'times', times: 3 })
  })

  it('says under half for a number below half the usual', () => {
    expect(ownNumberNote(17, NOVEMBER_USUAL)).toEqual({ kind: 'under_half' })
    expect(ownNumberNote(16, { num: 34n, den: 1n })).toEqual({ kind: 'under_half' })
    // Exactly half is not under it.
    expect(ownNumberNote(17, { num: 34n, den: 1n })).toBeNull()
  })

  it('says nothing between half and three times, or without a usual', () => {
    expect(ownNumberNote(18, NOVEMBER_USUAL)).toBeNull()
    expect(ownNumberNote(40, NOVEMBER_USUAL)).toBeNull()
    expect(ownNumberNote(102, NOVEMBER_USUAL)).toBeNull()
    expect(ownNumberNote(101, { num: 34n, den: 1n })).toBeNull()
    expect(ownNumberNote(12, { num: 0n, den: 1n })).toBeNull()
  })

  it('takes a whole number', () => {
    expect(() => ownNumberNote(2.5, NOVEMBER_USUAL)).toThrow(RangeError)
    expect(() => ownNumberNote(-3, NOVEMBER_USUAL)).toThrow(RangeError)
  })
})
