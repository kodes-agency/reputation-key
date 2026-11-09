import { formatNumber } from '#/lib/format'
import { cn } from '#/lib/utils'
import type { Tone } from './tone'

/**
 * The solid fill of a bar on the quiet `--muted` track: each tone's text-grade ink,
 * strong enough to read as a graphic (3:1; `progress-bar.test.ts` holds each to it
 * in both themes). `neutral` is the foreground at 70%. It lives here, not in
 * `tone.ts`, because Badge and Alert read that module in first paint and only this
 * lazy component reads the fills.
 */
export const TONE_BAR: Readonly<Record<Tone, string>> = {
  positive: 'bg-positive',
  warn: 'bg-warn',
  negative: 'bg-negative',
  info: 'bg-link',
  neutral: 'bg-foreground/70',
}

export type ProgressBarProps = Readonly<{
  /** What has been reached. A count past `max` fills the bar and no more. */
  value: number
  /** The whole the value is counted toward. */
  max: number
  /** What the bar counts, for assistive technology: "Qualified scans this month". */
  label: string
  /**
   * The value as a sentence, "64 of 120 so far". Defaults to "64 of 120", and
   * says the whole truth for a count past its whole ("150 of 120").
   */
  valueText?: string
  /** `neutral` counts with no verdict; the others are for a bar that carries one. */
  tone?: Tone
  /**
   * A point on the way, as a share of the bar from 0 to 1 (the next tenth on the
   * way to a rating goal): a notch cut through the track. It is drawn only; the
   * words beside the bar say what it marks.
   */
  marker?: number | null
  className?: string
}>

/** The share of the whole reached, held inside the bar; nothing for a whole of nothing. */
export function progressFraction(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0
  return Math.min(1, Math.max(0, value / max))
}

/**
 * A track and a fill that grows from the left. The fill is a `scaleX` transform, so
 * it stays on the compositor and holds still for reduced motion. It is a
 * `progressbar` with value, range and a sentence; the words beside it stay the
 * caller's.
 */
export function ProgressBar({
  value,
  max,
  label,
  valueText,
  tone = 'neutral',
  marker = null,
  className,
}: ProgressBarProps) {
  const fraction = progressFraction(value, max)
  const notch = marker === null ? null : progressFraction(marker, 1)
  return (
    <div
      role="progressbar"
      data-slot="progress-bar"
      data-tone={tone}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(Math.max(value, 0), max)}
      aria-valuetext={valueText ?? `${formatNumber(value)} of ${formatNumber(max)}`}
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-full bg-muted',
        className,
      )}
    >
      <div
        className={cn(
          'h-full w-full origin-left rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none',
          TONE_BAR[tone],
        )}
        style={{ transform: `scaleX(${fraction})` }}
      />
      {notch === null ? null : (
        // A layer as wide as the track, moved by a transform: the notch is its
        // left edge, so no layout property places it.
        <span
          data-slot="progress-bar-marker"
          aria-hidden="true"
          className="absolute inset-0"
          style={{ transform: `translateX(${notch * 100}%)` }}
        >
          <span className="absolute inset-y-0 left-0 w-0.5 -translate-x-1/2 bg-background" />
        </span>
      )}
    </div>
  )
}
