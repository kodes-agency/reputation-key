// A count card's comparison line: the trend, plus the absolute prior figure so a
// percentage never stands without the numbers behind it.

type CountComparison = Readonly<{
  trend: number | null
  priorValue: number | null
  /** Set when the prior window opens before the measure was counted at all. */
  priorUnavailableReason?: 'measure_not_yet_counted'
}>

function direction(trend: number): string {
  if (trend > 0) return '↑'
  return trend < 0 ? '↓' : '—'
}

export function countComparisonHint({
  trend,
  priorValue,
  priorUnavailableReason,
}: CountComparison): string {
  if (priorValue === null) {
    return priorUnavailableReason === undefined
      ? '—'
      : 'Prior period predates this measure'
  }
  const prior = priorValue.toLocaleString('en-US')
  if (trend === null) return `Prior period: ${prior}`
  return `${direction(trend)} ${Math.abs(trend)}% · prior ${prior}`
}
