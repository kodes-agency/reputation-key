// The running Monthly portal goal's bar: the month's figure against its number
// on the neutral fill (a count, with no verdict), and a tick where a steady
// month would be today (copy deck G-32). No number is printed for the tick: the
// pace word judges against 90% of that line, not the line itself. The tick is
// a layer over the bar rather than the bar's own notch, so it can stand proud
// of the track in foreground ink; both move by transform only. It is drawn
// only; the bar's sentence says the days and the pace.
import { ProgressBar } from '#/components/ui/progress-bar'

type Props = Readonly<{
  value: number
  max: number
  /** Where a steady month would be today, as a share of the bar; null draws none. */
  tick: number | null
  /** "Private ratings in November" */
  label: string
  /** "23 of 40 private ratings, 9 days left, below pace" */
  valueText: string
}>

/** How far the tick stands above and below the 8px track. */
const TICK_REACH = { top: -4, bottom: -4 } as const

export function PortalGoalBar({ value, max, tick, label, valueText }: Props) {
  return (
    <div className="relative" data-slot="portal-goal-bar">
      <ProgressBar
        value={value}
        max={max}
        label={label}
        valueText={valueText}
        tone="neutral"
      />
      {tick === null ? null : (
        // A layer as wide as the bar, moved by a transform: the tick is its
        // left edge, so no layout property places it.
        <span
          aria-hidden="true"
          data-slot="portal-goal-bar-tick"
          className="pointer-events-none absolute inset-0"
          style={{ transform: `translateX(${Math.min(Math.max(tick, 0), 1) * 100}%)` }}
        >
          <span
            className="absolute left-0 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
            style={TICK_REACH}
          />
        </span>
      )}
    </div>
  )
}
