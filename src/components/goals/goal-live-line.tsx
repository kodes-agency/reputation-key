// The live line under an active goal on the Goals list: the month so far in
// words, and for a count with one subject a neutral bar. It counts and does not
// judge (no good or bad colour), like the goal card on a group's page.
import { ProgressBar } from '#/components/ui/progress-bar'
import type { GoalListProgress } from '#/contexts/reporting/application/public-api'
import { goalLiveView } from './goal-live-view'

type Props = Readonly<{ goal: GoalListProgress }>

export function GoalLiveLine({ goal }: Props) {
  const view = goalLiveView(goal)
  if (view === null) return null
  return (
    <div data-slot="goal-live-line" className="mt-1.5 flex flex-col gap-1.5">
      <p className="text-sm tabular-nums">{view.text}</p>
      {view.bar === null ? null : <ProgressBar className="max-w-64" {...view.bar} />}
    </div>
  )
}
