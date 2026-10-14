// The live line under an active goal on the Goals list: the month so far in
// words, and for a count with one subject a neutral bar. It counts and does not
// judge (no good or bad colour), like the goal card on a group's page. The one
// exception is the nudge "below pace" for a count that is, in quiet amber text;
// the bar stays neutral, so the amber is two words and never a verdict on the
// month.
//
// Where the nudge goes is decided by the room the row's cell has, because the
// room a row keeps while its month is read cannot know whether it will say it.
// A row on a phone has a cell of about 230 px (the status column shares its
// line), where the sentence and the nudge do not fit one line: a nudge that
// followed the days left would wrap to a second line only for the rows that are
// below pace, and push everything under them down when the figure arrives. So
// from 24 rem the nudge follows the days left, as one sentence; below it, it sits
// beside the bar, on a line the bar keeps as high as the nudge whether it is
// there or not. The cell is a container of its own, so it is the cell that
// decides and not the window (a sidebar, or the status column, narrows it).
import { ProgressBar } from '#/components/ui/progress-bar'
import { Skeleton } from '#/components/ui/skeleton'
import { TONE_INK } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import type { GoalListProgress } from '#/contexts/reporting/application/public-api'
import { goalLiveView, type GoalLiveShape } from './goal-live-view'

type Props = Readonly<{ goal: GoalListProgress }>

// The slot every live line sits in, and the one its placeholder keeps, so the
// two take the same room. A line alone stacks inside it; a line with a bar is a
// container (`@container`: a container is queried by what is inside it, so the
// grid below is its child) holding a small grid whose second row is the bar's.
// The grid's columns are the two places the nudge takes. Narrow, the sentence
// spans the row and the bar leaves the nudge a column beside it. From `@sm`
// (24 rem) the first column is the sentence, the nudge follows it, and the bar
// spans the row. The narrow bar row is one `text-sm` line high (`1.25rem`), what
// the nudge needs, so it is as high with the nudge as without it; from `@sm` it
// is the bar's own height, for the nudge is on the line above.
const SLOT: Readonly<Record<GoalLiveShape, string>> = {
  line: 'mt-1.5',
  line_and_bar: '@container mt-1.5',
}
const BODY: Readonly<Record<GoalLiveShape, string>> = {
  line: 'flex flex-col gap-1.5',
  line_and_bar:
    'grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1.25rem] gap-x-2 gap-y-1.5 @sm:grid-cols-[auto_minmax(0,1fr)] @sm:grid-rows-[auto_auto] @sm:gap-x-1',
}

// Where each part of a count's line sits in that grid. The nudge is in reading
// order between the sentence and the bar, and moves beside the bar when narrow.
const SENTENCE_ROW = 'col-span-2 col-start-1 row-start-1'
const SENTENCE = `${SENTENCE_ROW} @sm:col-span-1`
const NOTE =
  'col-start-2 row-start-2 self-center whitespace-nowrap before:hidden before:text-foreground before:content-["·"] @sm:row-start-1 @sm:self-auto @sm:before:mr-1 @sm:before:inline'
const BAR_ROW = 'col-span-2 col-start-1 row-start-2 max-w-64 self-center'
const BAR = 'col-start-1 row-start-2 max-w-64 self-center @sm:col-span-2'

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
        {view.paceNote === null ? null : (
          <span data-slot="goal-live-pace" className={cn(NOTE, TONE_INK.warn, 'text-sm')}>
            {view.paceNote}
          </span>
        )}
        <ProgressBar
          className={cn(BAR, view.paceNote === null && 'col-span-2')}
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
