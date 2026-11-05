// When Show all removes its own control, focus the first revealed row so keyboard
// navigation keeps its place.

import { useCallback, useId, useRef, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { RowButton } from '#/components/ui/button-layouts'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'

/** A card closed until asked: its title is the way to open it. */
export function GoalClosedCard({
  title,
  region = false,
  defaultOpen = false,
  children,
}: Readonly<{
  title: string
  region?: boolean
  defaultOpen?: boolean
  children: ReactNode
}>) {
  const titleId = useId()
  return (
    <Card
      className="gap-0 py-0"
      role={region ? 'region' : undefined}
      aria-labelledby={region ? titleId : undefined}
    >
      <Collapsible defaultOpen={defaultOpen}>
        <CardHeader>
          <CardTitle as="h2" id={region ? titleId : undefined}>
            <CollapsibleTrigger asChild>
              <RowButton variant="ghost" className="group font-semibold">
                {title}
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
                />
              </RowButton>
            </CollapsibleTrigger>
          </CardTitle>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="flex flex-col gap-3 pb-3">{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

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
  /** Opens already, where nothing needs asking first; closed until asked otherwise. */
  defaultOpen?: boolean
}>

/** The row's classes, spelled whole. The row the focus is sent to has no ring of its own. */
const ROW = 'flex gap-x-4 py-2 last:pb-0'
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
  defaultOpen = false,
}: Props) {
  // Once, however often the list is drawn again: a row's key moves with its index.
  const focused = useRef(false)
  const focusRevealed = useCallback((item: HTMLLIElement | null) => {
    if (item === null || focused.current) return
    focused.current = true
    item.focus()
  }, [])
  return (
    <GoalClosedCard title={title} region={region} defaultOpen={defaultOpen}>
      <ul className="flex flex-col divide-y border-t text-sm">
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
    </GoalClosedCard>
  )
}
