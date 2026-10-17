// Monthly portal goal — the numbers a goal is set in (ADR 0068 decision 4).
//
// One grid serves the recommended number's rounding and the − and + steps of
// the number box, so a rounded recommendation is always a step the box can
// reach and a step is always a number the card could have offered:
//
//   every whole number from 1 to 29, then every 5 to 100, every 10 to 500,
//   and every 50 above that.
//
// Rounding is up, onto the grid, from an exact rational: the usual is a sum of
// counts over live days, whose denominators can overflow a float's integers,
// so no float decides which step a number lands on. Pure.

/** A non-negative exact number `num / den`, `den` > 0. */
export type ExactCount = Readonly<{ num: bigint; den: bigint }>

/** Where each band of the grid ends, and the step it moves in. */
const BANDS: ReadonlyArray<Readonly<{ upTo: bigint; step: bigint }>> = [
  { upTo: 29n, step: 1n },
  { upTo: 100n, step: 5n },
  { upTo: 500n, step: 10n },
]
const STEP_ABOVE_500 = 50n

/** ⌈num / den⌉ for non-negative integers. */
const ceilDiv = (num: bigint, den: bigint): bigint => (num + den - 1n) / den

/** The smallest grid number at or above `value`; 1 for anything up to 1. */
export function goalStepAtOrAbove(value: ExactCount): number {
  if (value.den <= 0n || value.num < 0n) {
    throw new RangeError('A goal number is rounded from a non-negative exact count')
  }
  if (value.num <= value.den) return 1
  const band = BANDS.find(({ upTo }) => value.num <= upTo * value.den)
  const step = band?.step ?? STEP_ABOVE_500
  return Number(ceilDiv(value.num, value.den * step) * step)
}

/** The next grid number above a whole number: `up(37)` is 40. */
export function goalStepUp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('A goal number steps up from a whole number')
  }
  return goalStepAtOrAbove({ num: BigInt(value) + 1n, den: 1n })
}
