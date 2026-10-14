import { formatNumber } from '#/lib/format'
import { cn } from '#/lib/utils'
import type { Tone } from './tone'

/**
 * The solid fill of a bar on the quiet `--muted` track: each tone's text-grade
 * ink, strong enough to read against the track as a graphic (3:1;
 * `progress-bar.test.ts` holds each to it in both themes). `neutral` is the
 * foreground at 70%: a bar that counts, with no verdict. It lives here, not in
 * `tone.ts`, because every Badge and Alert reads that module in first paint and
 * only this lazy component reads the fills.
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
  className?: string
}>

/** The share of the whole reached, held inside the bar; nothing for a whole of nothing. */
export function progressFraction(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0
  return Math.min(1, Math.max(0, value / max))
}

/**
 * How far a count has got toward a whole: a track and a fill that grows from
 * the left. The fill is a transform (`scaleX`), so it moves on the compositor
 * and a change in it never lays the row out again, and it holds still for a
 * reader who asks for reduced motion.
 *
 * It is a `progressbar` with its value, range and a sentence, because the fill
 * is no use to a screen reader. The words beside it (a figure, "so far") stay
 * the caller's: this draws the bar, not the claim.
 */
export function ProgressBar({
  value,
  max,
  label,
  valueText,
  tone = 'neutral',
  className,
}: ProgressBarProps) {
  const fraction = progressFraction(value, max)
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
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className={cn(
          'h-full w-full origin-left rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none',
          TONE_BAR[tone],
        )}
        style={{ transform: `scaleX(${fraction})` }}
      />
    </div>
  )
}
