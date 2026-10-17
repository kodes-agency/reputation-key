import { describe, expect, it } from 'vitest'
import { goalStepAtOrAbove, goalStepUp, type ExactCount } from './goal-number-steps'

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
})
