// A goal's History on its detail page (ADR 0068, amended 2026-10-19: one goal
// design system): a card titled by the goal, one row to a dated fact, newest
// first, the date in a column of its own and the fact beside it, and a line under
// the list for what a goal adds to it. A goal brings its rows finished (the date,
// and the words as a node, so a row may carry a link or a second line); the list
// only lays them out.
//
// Four options a goal may ask for and the other never passes: `more`, a control
// under the list (a "Show all"); `revealedFrom`, the row that control added, which
// takes the focus once so a keyboard does not lose its place; `region`, which
// makes the card a landmark named by its title; and `wideDates`, a date column
// with room for a year. A list that passes none draws a card with no landmark and
// a column of five rem, as it always did.
import { useCallback, useId, useRef, type ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'

/** One dated fact. */
type GoalHistoryRow = Readonly<{
  key: string
  /** The date, in the narrow column. */
  when: string
  /** The words beside it, finished. */
  content: ReactNode
}>

type Props = Readonly<{
  /** The card's title, an h2. */
  title: string
  rows: readonly GoalHistoryRow[]
  /** A small line under the list. */
  foot?: ReactNode
  /** A control under the list that shows the rows still hidden. */
  more?: ReactNode
  /** The index of the first row `more` added: it takes the focus, once, when it appears. */
  revealedFrom?: number | null
  /** Draws the card as a landmark named by its title; off, the title only heads the card. */
  region?: boolean
  /** The date column is wide enough for a year ("Dec 28, 2025"), which five rem cannot hold on one line. */
  wideDates?: boolean
}>

/** The row's classes, spelled whole. The row the focus is sent to has no ring of its own. */
const ROW = 'flex gap-x-4 py-2 first:pt-0 last:pb-0'
const REVEALED_ROW = `${ROW} outline-none`

/** The date cell's classes: five rem wide, or the width below for a date with its year. */
const WHEN = 'w-20 shrink-0 text-muted-foreground tabular-nums'
const WHEN_WIDE = 'shrink-0 text-muted-foreground tabular-nums'

/** Six rem, inline: a new utility class would grow the stylesheet every page loads. */
const WIDE_WHEN_WIDTH = { width: '6rem' } as const

export function GoalHistoryList({
  title,
  rows,
  foot,
  more,
  revealedFrom = null,
  region = false,
  wideDates = false,
}: Props) {
  const titleId = useId()
  // Once, however often the list is drawn again: a row's key moves with its index.
  const focused = useRef(false)
  const focusRevealed = useCallback((item: HTMLLIElement | null) => {
    if (item === null || focused.current) return
    focused.current = true
    item.focus()
  }, [])
  return (
    <Card
      className="gap-4"
      role={region ? 'region' : undefined}
      aria-labelledby={region ? titleId : undefined}
    >
      <CardHeader>
        <CardTitle as="h2" id={region ? titleId : undefined}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col divide-y text-sm">
          {rows.map((row, index) => {
            const revealed = index === revealedFrom
            return (
              <li
                key={row.key}
                ref={revealed ? focusRevealed : undefined}
                tabIndex={revealed ? -1 : undefined}
                className={revealed ? REVEALED_ROW : ROW}
              >
                <span
                  className={wideDates ? WHEN_WIDE : WHEN}
                  style={wideDates ? WIDE_WHEN_WIDTH : undefined}
                >
                  {row.when}
                </span>
                {row.content}
              </li>
            )
          })}
        </ul>
        {more}
        {foot}
      </CardContent>
    </Card>
  )
}
