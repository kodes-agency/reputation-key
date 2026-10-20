// The live line under an active goal on the Goals list: the month so far in
// words, and for a count with one subject a neutral bar and, where the pace was
// judged, the pace pill. The words count and do not judge (no good or bad
// colour); the pill is the one place a verdict shows, and it is the same pill
// the goal's card and page wear (ADR 0068, amended 2026-10-19: one goal design
// system): "On pace" or "Below pace", nothing for a month the rule does not
// judge. The bar stays neutral.
//
// Where the pill goes is decided by the room the row's cell has, because the
// room a row keeps while its month is read cannot know whether it will draw
// one. A row on a phone has a cell narrower than 24 rem (288 px on a 320 px
// screen), where the sentence and the pill may not fit one line (the sentence
// with five-digit figures is 242 px and "Below pace" 97 px, 347 px with the
// gap): a pill that followed the days left would wrap to a second line only for
// the rows that have one, and push everything under them down when the figure
// arrives. So from 24 rem the pill follows the days left, on the sentence's own
// line; below it, it sits beside the bar, on a line the bar keeps as high as the
// pill whether it is there or not. The cell is a container of its own, so it is
// the cell that decides and not the window (a sidebar, or the page's gutters,
// narrow it).
import { ProgressBar } from '#/components/ui/progress-bar'
import { Skeleton } from '#/components/ui/skeleton'
import { StatusBadge } from '#/components/ui/status-badge'
import { cn } from '#/lib/utils'
import type { GoalListProgress } from '#/contexts/reporting/application/public-api'
import { goalLiveView, type GoalLiveShape } from './goal-live-view'

type Props = Readonly<{ goal: GoalListProgress }>

// The slot every live line sits in, and the one its placeholder keeps, so the
// two take the same room. A line alone stacks inside it; a line with a bar is a
// container (`@container`: a container is queried by what is inside it, so the
// grid below is its child) holding a small grid whose second row is the bar's.
// The grid's columns are the two places the pill takes. Narrow, the sentence
// spans the row and the bar leaves the pill a column beside it. From `@sm`
// (24 rem) the first column is the sentence, the pill follows it, and the bar
// spans the row. The pill is 22 px high (a `text-xs` line, 2 px of padding and a
// border on each side), so the row it sits in is that high whether it is there
// or not: the bar's row when narrow (`1.375rem`), the sentence's row from `@sm`
// (`minmax(1.375rem,auto)`, so a sentence that wraps still grows it).
const SLOT: Readonly<Record<GoalLiveShape, string>> = {
  line: 'mt-1.5',
  line_and_bar: '@container mt-1.5',
}
const BODY: Readonly<Record<GoalLiveShape, string>> = {
  line: 'flex flex-col gap-1.5',
  line_and_bar:
    'grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1.375rem] items-center gap-x-2 gap-y-1.5 @sm:grid-cols-[auto_minmax(0,1fr)] @sm:grid-rows-[minmax(1.375rem,auto)_auto]',
}

// Where each part of a count's line sits in that grid. The pill is in reading
// order between the sentence and the bar, and moves beside the bar when narrow.
const SENTENCE_ROW = 'col-span-2 col-start-1 row-start-1'
const SENTENCE = `${SENTENCE_ROW} @sm:col-span-1`
const PACE = 'col-start-2 row-start-2 flex @sm:row-start-1'
const BAR_ROW = 'col-span-2 col-start-1 row-start-2 max-w-64'
const BAR = 'col-start-1 row-start-2 max-w-64 @sm:col-span-2'

export function GoalLiveLine({ goal }: Props) {
  const view = goalLiveView(goal)
  if (view === null) return null
  if (view.bar === null) {
    return (
      <div data-slot="goal-live-line" className={SLOT.line}>
        <div className={BODY.line}>
          <p className="text-sm tabular-nums">{view.text}</p>
        </div>
      </div>
    )
  }
  return (
    <div data-slot="goal-live-line" className={SLOT.line_and_bar}>
      <div className={BODY.line_and_bar}>
        <p className={cn(SENTENCE, 'text-sm tabular-nums')}>{view.text}</p>
        {view.pace === null ? null : (
          <span data-slot="goal-live-pace" className={PACE}>
            <StatusBadge {...view.pace} />
          </span>
        )}
        <ProgressBar
          className={cn(BAR, view.pace === null && 'col-span-2')}
          {...view.bar}
        />
      </div>
    </div>
  )
}

/**
 * What a row shows while its month is still being read: the room its live line
 * will take, as quiet blocks. The rows are already on the page when the figures
 * arrive, so without it every row below the first would be pushed down. A line
 * is one `text-sm` line high (`h-5`) and a bar one `ProgressBar` high (`h-2`),
 * on the row the loaded line gives it. It says nothing to assistive technology:
 * the line announces itself when it arrives.
 */
export function GoalLiveLinePending({ shape }: Readonly<{ shape: GoalLiveShape }>) {
  return (
    <div data-slot="goal-live-line-pending" aria-hidden="true" className={SLOT[shape]}>
      <div className={BODY[shape]}>
        <div
          className={cn(
            'flex h-5 items-center',
            shape === 'line_and_bar' && SENTENCE_ROW,
          )}
        >
          <Skeleton className="h-3.5 w-48 max-w-full" />
        </div>
        {shape === 'line_and_bar' ? (
          <Skeleton className={cn(BAR_ROW, 'h-2 rounded-full')} />
        ) : null}
      </div>
    </div>
  )
}
