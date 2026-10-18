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
// so no float decides which step a number lands on. The note an own number
// gets (about 4 times the usual, or under half of it) is decided the same way,
// from the exact usual. Pure.

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

/** A whole number at or above zero, or a RangeError saying what `what` takes. */
function wholeNumber(value: number, what: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(what)
  return BigInt(value)
}

/** The next grid number above a whole number: `up(37)` is 40. */
export function goalStepUp(value: number): number {
  const whole = wholeNumber(value, 'A goal number steps up from a whole number')
  return goalStepAtOrAbove({ num: whole + 1n, den: 1n })
}

/** The largest grid number at or below a whole number of at least 1. */
function goalStepAtOrBelow(value: bigint): bigint {
  // A band ends on one of its own steps (29, 100, 500), so a number at its end
  // is its own floor.
  const step = BANDS.find(({ upTo }) => value <= upTo)?.step ?? STEP_ABOVE_500
  return (value / step) * step
}

/** The grid number before a whole number: `down(37)` is 35; none below 1. */
export function goalStepDown(value: number): number | null {
  const whole = wholeNumber(value, 'A goal number steps down from a whole number')
  return whole <= 1n ? null : Number(goalStepAtOrBelow(whole - 1n))
}

type OwnNumberNote =
  Readonly<{ kind: 'times'; times: number }> | Readonly<{ kind: 'under_half' }>

/**
 * What the sheet says of a number the manager chose for themselves, against the
 * usual for that month: about how many times it is, once it is three times or
 * more (half up: 120 against 34.29 is about 4), or that it is under half; else
 * nothing. Nothing either without a usual to measure against.
 */
export function ownNumberNote(typed: number, usual: ExactCount): OwnNumberNote | null {
  const own = wholeNumber(typed, 'An own number is a whole number')
  if (usual.den <= 0n || usual.num <= 0n) return null
  const scaled = own * usual.den
  if (scaled >= 3n * usual.num) {
    return { kind: 'times', times: Number((2n * scaled + usual.num) / (2n * usual.num)) }
  }
  return 2n * scaled < usual.num ? { kind: 'under_half' } : null
}
