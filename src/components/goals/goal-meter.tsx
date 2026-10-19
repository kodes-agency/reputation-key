// A goal's progress meter (ADR 0068, amended 2026-10-19: one goal design system):
// a quiet caption, the figure, a bar with no verdict and a foot line. The words
// are the goal's own and arrive finished; the meter only lays them out, so a
// goal that moves onto it keeps its markup. The bar's tone is neutral: the pill
// in the card's corner is where the pace is said.
//
// A goal whose way has a fixed length may also ask for two things the other
// goal's meter never draws: a tick where a steady pace would stand today, and
// the way's first and last point under the bar. Both are options a goal passes
// in. A meter that passes neither draws the bar on its own, as before.
import type { ReactNode } from 'react'
import { ProgressBar } from '#/components/ui/progress-bar'

type Props = Readonly<{
  /** The meter's `data-slot`. */
  slot: string
  /** The quiet line above the figure; none when the card's own heading says it. */
  caption: ReactNode
  /** The figure, "2 of 7". */
  figure: ReactNode
  /**
   * The bar, with the words a screen reader hears for it. `tick` is where a
   * steady pace would stand today, as a share of the bar from 0 to 1: a number
   * draws it, `null` is a meter that has a tick and none to show today, and
   * leaving it out is a meter with no tick at all.
   */
  bar: Readonly<{
    value: number
    max: number
    label: string
    valueText: string
    tick?: number | null
  }>
  /**
   * The way's first and last point under the bar ("Nov 1" … "Nov 30"). Drawn
   * only, hidden from assistive technology: the bar's sentence says the rest.
   */
  axis?: Readonly<{ from: string; to: string }>
  /** The small line under the bar; none when there is nothing to add. */
  foot: ReactNode
  /**
   * Drawn only on a card at least 48rem wide (its container's `@3xl`), where a
   * narrower card says the same in a line of its own. Otherwise at every width.
   */
  wideOnly?: boolean
}>

/** The meter's classes, spelled whole: a wide-only meter reads `hidden … @3xl:flex`. */
const PLACEMENT = {
  always: 'flex flex-col gap-1.5',
  wideOnly: 'hidden flex-col gap-1.5 @3xl:flex',
} as const

/** How far the tick stands above and below the 8px track. */
const TICK_REACH = { top: -4, bottom: -4 } as const

/**
 * The tick's layer is as wide as the bar and moved right by the tick's share of
 * it, so most of it hangs past the bar's right edge. A transformed box still
 * widens its scroll container, and nothing between here and the page's
 * scrolling `<main>` clips, so the wrapper clips on x alone: the page never
 * scrolls sideways, and the tick still stands above and below the track. On the
 * last day the tick sits on the bar's end, and its outer half is clipped.
 */
const CLIP_SIDES = { overflowX: 'clip' } as const

type BarProps = Props['bar']

function Bar({ tick, ...bar }: BarProps) {
  const progress = <ProgressBar {...bar} />
  if (tick === undefined) return progress
  return (
    <div className="relative" data-slot="goal-meter-bar" style={CLIP_SIDES}>
      {progress}
      {tick === null ? null : (
        // A layer as wide as the bar, moved by a transform: the tick is its
        // left edge, so no layout property places it.
        <span
          aria-hidden="true"
          data-slot="goal-meter-tick"
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

function BarWithAxis({
  bar,
  axis,
}: Readonly<{ bar: BarProps; axis: NonNullable<Props['axis']> }>) {
  return (
    <div className="flex flex-col gap-1">
      <Bar {...bar} />
      <p
        aria-hidden="true"
        className="flex justify-between text-xs text-muted-foreground tabular-nums"
      >
        <span>{axis.from}</span>
        <span>{axis.to}</span>
      </p>
    </div>
  )
}

export function GoalMeter({
  slot,
  caption,
  figure,
  bar,
  axis,
  foot,
  wideOnly = false,
}: Props) {
  return (
    <div data-slot={slot} className={wideOnly ? PLACEMENT.wideOnly : PLACEMENT.always}>
      {caption === null ? null : (
        <p className="text-sm text-muted-foreground">{caption}</p>
      )}
      <p className="text-lg font-semibold tabular-nums">{figure}</p>
      {axis === undefined ? <Bar {...bar} /> : <BarWithAxis bar={bar} axis={axis} />}
      {foot === null ? null : <p className="text-xs text-muted-foreground">{foot}</p>}
    </div>
  )
}
