// The live line under an active goal on the Goals list: the month so far in
// words, and for a count with one subject a neutral bar. It counts and does not
// judge (no good or bad colour), like the goal card on a group's page. The one
// exception is the nudge "below pace", in quiet amber text after the days left,
// for a count that is; the bar stays neutral, so the amber is a few words and
// never a verdict on the month.
import { ProgressBar } from '#/components/ui/progress-bar'
import { Skeleton } from '#/components/ui/skeleton'
import { TONE_INK } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import type { GoalListProgress } from '#/contexts/reporting/application/public-api'
import { goalLiveView, type GoalLiveShape } from './goal-live-view'

type Props = Readonly<{ goal: GoalListProgress }>

// The slot every live line sits in, and the one its placeholder keeps, so the
// two take the same room.
const SLOT = 'mt-1.5 flex flex-col gap-1.5'

export function GoalLiveLine({ goal }: Props) {
  const view = goalLiveView(goal)
  if (view === null) return null
  return (
    <div data-slot="goal-live-line" className={SLOT}>
      <p className="text-sm tabular-nums">
        {view.text}
        {view.paceNote === null ? null : (
          <>
            {' · '}
            <span
              data-slot="goal-live-pace"
              className={cn(TONE_INK.warn, 'whitespace-nowrap')}
            >
              {view.paceNote}
            </span>
          </>
        )}
      </p>
      {view.bar === null ? null : <ProgressBar className="max-w-64" {...view.bar} />}
    </div>
  )
}

/**
 * What a row shows while its month is still being read: the room its live line
 * will take, as quiet blocks. The rows are already on the page when the figures
 * arrive, so without it every row below the first would be pushed down. A line
 * is one `text-sm` line high (`h-5`) and a bar one `ProgressBar` high (`h-2`).
 * It says nothing to assistive technology: the line announces itself when it
 * arrives.
 */
export function GoalLiveLinePending({ shape }: Readonly<{ shape: GoalLiveShape }>) {
  return (
    <div data-slot="goal-live-line-pending" aria-hidden="true" className={SLOT}>
      <div className="flex h-5 items-center">
        <Skeleton className="h-3.5 w-48 max-w-full" />
      </div>
      {shape === 'line_and_bar' ? (
        <Skeleton className="h-2 max-w-64 rounded-full" />
      ) : null}
    </div>
  )
}
