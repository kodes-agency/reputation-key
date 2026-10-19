// A goal's progress meter (ADR 0068, amended 2026-10-19: one goal design system):
// a quiet caption, the figure, a bar with no verdict and a foot line. The words
// are the goal's own and arrive finished; the meter only lays them out, so a
// goal that moves onto it keeps its markup. The bar's tone is neutral: the pill
// in the card's corner is where the pace is said.
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

export function GoalMeter({ slot, caption, figure, bar, foot, wideOnly = false }: Props) {
  return (
    <div data-slot={slot} className={wideOnly ? PLACEMENT.wideOnly : PLACEMENT.always}>
      {caption === null ? null : (
        <p className="text-sm text-muted-foreground">{caption}</p>
      )}
      <p className="text-lg font-semibold tabular-nums">{figure}</p>
      <ProgressBar
        value={bar.value}
        max={bar.max}
        label={bar.label}
        valueText={bar.valueText}
      />
      {foot === null ? null : <p className="text-xs text-muted-foreground">{foot}</p>}
    </div>
  )
}
