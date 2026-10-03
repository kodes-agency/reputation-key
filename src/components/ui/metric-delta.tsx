import { ArrowDown, ArrowUp } from 'lucide-react'
import { formatNumber } from '#/lib/format'
import { cn } from '#/lib/utils'

export type MetricDeltaDirection = 'up' | 'down' | 'flat'

export type MetricDeltaProps = Readonly<{
  /** The signed change from the comparison period: positive is up, negative is down. */
  value: number
  /**
   * `percent` prints a trailing % and drops trailing zeros ("12%"). `points` (the
   * default, a rating) prints the bare figure and keeps its decimals ("1.0"), as
   * the headline figure it qualifies does ("4.0").
   */
  unit?: 'points' | 'percent'
  /** The decimals to keep, at most for `percent` and exactly for `points`. Defaults to one. */
  fractionDigits?: number
  /** Names the baseline, e.g. `dashboardRangeComparisonLabel(range)`: "vs the previous 30 days". */
  comparisonLabel: string
  className?: string
}>

const DEFAULT_FRACTION_DIGITS = 1

/**
 * Which way a change went. A move too small to show at the digits kept is flat,
 * because "up 0" is not a change a reader can act on.
 */
export function metricDeltaDirection(
  value: number,
  fractionDigits: number = DEFAULT_FRACTION_DIGITS,
): MetricDeltaDirection {
  const shown = Number(Math.abs(value).toFixed(fractionDigits))
  if (shown === 0) return 'flat'
  return value > 0 ? 'up' : 'down'
}

const DIRECTION_STYLE = {
  up: { Icon: ArrowUp, ink: 'text-positive', word: 'Up' },
  down: { Icon: ArrowDown, ink: 'text-negative', word: 'Down' },
} as const

/**
 * A period-over-period change: an arrow, the size, the baseline, and the
 * direction in words. The ink is the text-grade direction pair
 * (`--positive` / `--negative`), which clears 4.5:1 at body sizes and is never
 * the only carrier of meaning: the arrow and the screen-reader word say the same.
 *
 * Callers own the cases around it (no comparable period yet, too few ratings to
 * compare): this draws a change that exists.
 */
export function MetricDelta({
  value,
  unit = 'points',
  fractionDigits = DEFAULT_FRACTION_DIGITS,
  comparisonLabel,
  className,
}: MetricDeltaProps) {
  const direction = metricDeltaDirection(value, fractionDigits)
  if (direction === 'flat') {
    return (
      <span data-slot="metric-delta" data-direction="flat" className={className}>
        {`No change ${comparisonLabel}`}
      </span>
    )
  }

  const { Icon, ink, word } = DIRECTION_STYLE[direction]
  const size = formatNumber(Math.abs(value), {
    maximumFractionDigits: fractionDigits,
    ...(unit === 'points' ? { minimumFractionDigits: fractionDigits } : {}),
  })
  return (
    <span
      data-slot="metric-delta"
      data-direction={direction}
      className={cn('inline-flex items-center gap-1 tabular-nums', ink, className)}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>
        <span className="sr-only">{word} </span>
        {`${size}${unit === 'percent' ? '%' : ''} ${comparisonLabel}`}
      </span>
    </span>
  )
}
