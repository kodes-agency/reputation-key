// A goal's bars, worked out (pure, 2026-11-01): one scale from none to a little
// above the highest figure, number or plan, so the plan's line and a month's mark
// always have room above the bars. The figures and words come from the goal.

export type GoalColumn = Readonly<{
  key: string
  /** Under the bar: "Oct 12", "Nov". */
  label: string
  /** Null draws no bar: a month that cannot be read is never a zero. */
  value: number | null
  /** On or in the bar; null prints none. */
  figure: string | null
  /** From before the goal, counted against it, or still counting. */
  tone: 'before' | 'since' | 'open'
  /** This column's own number, marked across its bar; null for none. */
  mark: number | null
  /** Met: a check beside the figure. */
  met: boolean
  /** What the line under the bars says when this one is chosen. */
  line: string
}>

export type GoalColumnsPlan = Readonly<{
  value: number
  /** The first column it runs from. */
  from: number
  /** Beside the caption: "Your plan: 7 a week". */
  words: string
}>

/** Headroom above the tallest thing drawn, so a figure on top of it stays inside the plot. */
const HEADROOM = 1.12
/** A bar this tall (share of the plot) holds its figure at its foot. */
const TALL_ENOUGH = 22
/** A mark this close above a bar: the figure goes over the mark, not between them. */
const MARK_CLEAR = 16

export function columnsModel(
  columns: readonly GoalColumn[],
  plan?: GoalColumnsPlan,
): Readonly<{
  columns: readonly (GoalColumn &
    Readonly<{
      height: number
      tickHeight: number | null
      tickGap: number
      tall: boolean
      figureAboveTick: boolean
    }>)[]
  plan: Readonly<{ left: number; height: number }> | null
}> {
  const peak = Math.max(
    1,
    plan?.value ?? 0,
    ...columns.flatMap((column) => [column.value ?? 0, column.mark ?? 0]),
  )
  const scale = 100 / (peak * HEADROOM)
  return {
    columns: columns.map((column) => {
      const height = (column.value ?? 0) * scale
      const tickHeight = column.mark === null ? null : column.mark * scale
      const gap = tickHeight === null ? 0 : tickHeight - height
      return {
        ...column,
        height,
        tickHeight,
        tall: height >= TALL_ENOUGH,
        tickGap: Math.max(0, gap),
        // Far above the bar the figure sits right on it; close, it goes over the mark.
        figureAboveTick: gap >= 0 && gap < MARK_CLEAR && tickHeight !== null,
      }
    }),
    plan:
      plan === undefined || columns.length === 0
        ? null
        : { left: (plan.from / columns.length) * 100, height: plan.value * scale },
  }
}
