// Counting helpers of the review-analysis v3 scorer. A rate over nothing is null,
// never 0 and never 1: a slice that holds no urgent case has no urgent recall, and
// a gate must say "not measurable" instead of passing or failing on an empty set.

/** A proportion, or null when nothing was there to count. */
export type Rate = number | null

export function ratio(numerator: number, denominator: number): Rate {
  return denominator === 0 ? null : numerator / denominator
}

/** The mean of the values that exist; null when none does. */
export function meanOf(values: readonly Rate[]): Rate {
  const present = values.filter((value): value is number => value !== null)
  if (present.length === 0) return null
  return present.reduce((total, value) => total + value, 0) / present.length
}

export type Prf = Readonly<{
  tp: number
  fp: number
  fn: number
  precision: Rate
  recall: Rate
  f1: Rate
}>

/**
 * Precision, recall and F1 from counts. F1 is 0 when something was predicted or
 * expected and nothing matched, and null only when there was nothing to match.
 */
export function prf(tp: number, fp: number, fn: number): Prf {
  const f1 = tp + fp + fn === 0 ? null : (2 * tp) / (2 * tp + fp + fn)
  return Object.freeze({
    tp,
    fp,
    fn,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    f1,
  })
}

/** A count per key, ascending by key, as a frozen record. */
export function tally<Key extends string>(
  keys: readonly Key[],
): Readonly<Partial<Record<Key, number>>> {
  const counts = new Map<Key, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  const sorted = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  return Object.freeze(Object.fromEntries(sorted) as Partial<Record<Key, number>>)
}

/** Round for display and for a stable report; never used before a comparison. */
export function rounded(value: Rate, digits = 4): Rate {
  if (value === null) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
