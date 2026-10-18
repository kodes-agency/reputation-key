// The Monthly portal goal's tile: a calendar leaf with the month on its band and
// the day under it (copy deck G-33). It is the portal goal's own mark, and none
// of the Google rating goal's numerals or rulers. The header shows today in the
// first weeks. The day it names is said in words wherever it matters, so the
// tile is hidden from assistive technology.
import { formatLocalDate } from '#/lib/format'

type Props = Readonly<{
  /** A Property-local day, `YYYY-MM-DD`. */
  day: string
}>

/** The size the tile's day is set in, between the type scale's steps. */
const DAY_SIZE = '15px'
/** Wide enough for "May 1" and "Dec 31" alike, so the tile never changes width. */
const TILE_WIDTH = '44px'

export function PortalGoalMonthTile({ day }: Props) {
  // "Oct 17": the band says "Oct" (uppercase by its class), the leaf "17".
  const [band = '', date = ''] = (formatLocalDate(day, { year: false }) ?? day).split(' ')
  return (
    <span
      aria-hidden="true"
      data-slot="portal-goal-month-tile"
      className="inline-flex shrink-0 flex-col items-center overflow-hidden rounded-md border"
      style={{ minWidth: TILE_WIDTH }}
    >
      <span className="w-full bg-muted px-1.5 text-center text-[10px] tracking-wide text-muted-foreground uppercase">
        {band}
      </span>
      <span
        className="display-title px-1.5 pb-0.5 font-semibold tabular-nums"
        style={{ fontSize: DAY_SIZE }}
      >
        {date}
      </span>
    </span>
  )
}
