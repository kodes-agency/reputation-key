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
  /** The bar, with the words a screen reader hears for it. */
  bar: Readonly<{ value: number; max: number; label: string; valueText: string }>
  /** The small line under the bar; none when there is nothing to add. */
  foot: ReactNode
}>

export function GoalMeter({ slot, caption, figure, bar, foot }: Props) {
  return (
    <div data-slot={slot} className="flex flex-col gap-1.5">
      {caption === null ? null : (
        <p className="text-sm text-muted-foreground">{caption}</p>
      )}
      <p className="text-lg font-semibold tabular-nums">{figure}</p>
      <ProgressBar {...bar} />
      {foot === null ? null : <p className="text-xs text-muted-foreground">{foot}</p>}
    </div>
  )
}
