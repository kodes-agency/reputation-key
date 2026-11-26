const LANCZOS_COEFFICIENTS = [
  0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531,
  -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6,
  1.5056327351493116e-7,
] as const

const LANCZOS_G = 7
const CONTINUED_FRACTION_EPSILON = 3e-14
const CONTINUED_FRACTION_MINIMUM = 1e-300
const CONTINUED_FRACTION_MAX_ITERATIONS = 200

function logGamma(value: number): number {
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value)
  }

  const shifted = value - 1
  let series = LANCZOS_COEFFICIENTS[0]
  for (let index = 1; index < LANCZOS_COEFFICIENTS.length; index += 1) {
    series += LANCZOS_COEFFICIENTS[index]! / (shifted + index)
  }
  const base = shifted + LANCZOS_G + 0.5

  return (
    0.5 * Math.log(2 * Math.PI) +
    (shifted + 0.5) * Math.log(base) -
    base +
    Math.log(series)
  )
}

function nonzeroFractionTerm(value: number): number {
  return Math.abs(value) < CONTINUED_FRACTION_MINIMUM ? CONTINUED_FRACTION_MINIMUM : value
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const sum = a + b
  const aPlusOne = a + 1
  const aMinusOne = a - 1
  let c = 1
  let d = 1 / nonzeroFractionTerm(1 - (sum * x) / aPlusOne)
  let fraction = d

  for (
    let iteration = 1;
    iteration <= CONTINUED_FRACTION_MAX_ITERATIONS;
    iteration += 1
  ) {
    const doubledIteration = 2 * iteration
    let coefficient =
      (iteration * (b - iteration) * x) /
      ((aMinusOne + doubledIteration) * (a + doubledIteration))
    d = 1 / nonzeroFractionTerm(1 + coefficient * d)
    c = nonzeroFractionTerm(1 + coefficient / c)
    fraction *= d * c

    coefficient =
      (-(a + iteration) * (sum + iteration) * x) /
      ((a + doubledIteration) * (aPlusOne + doubledIteration))
    d = 1 / nonzeroFractionTerm(1 + coefficient * d)
    c = nonzeroFractionTerm(1 + coefficient / c)
    const delta = d * c
    fraction *= delta

    if (Math.abs(delta - 1) < CONTINUED_FRACTION_EPSILON) return fraction
  }

  // Valid product inputs converge well before the guard; returning the best
  // approximation keeps the helper total for extreme but valid parameters.
  return fraction
}

/**
 * Computes the regularised incomplete beta without numerical integration.
 * The symmetry branch keeps the continued fraction in its stable region.
 */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    x < 0 ||
    x > 1 ||
    a <= 0 ||
    b <= 0
  ) {
    throw new RangeError('x must be in [0, 1], and a and b must be positive')
  }
  if (x === 0 || x === 1) return x

  const scale = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x),
  )

  if (x > (a + 1) / (a + b + 2)) {
    return 1 - (scale * betaContinuedFraction(1 - x, b, a)) / b
  }
  return (scale * betaContinuedFraction(x, a, b)) / a
}
