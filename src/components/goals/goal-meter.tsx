// Keep the bar neutral: the card pill carries the pace verdict.

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
