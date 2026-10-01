// The goal card on a group's page (board 13): the month and the measure, the
// figure so far against the target, a neutral bar and who set it. It is the live
// month to date and never the month's result, so there is no good or bad colour,
// and a figure that cannot be read says so instead of showing a zero.
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import type { GoalProgress } from '#/contexts/reporting/application/public-api'
import { goalCardView, type GoalCardContext } from './portal-group-goal-view'

type Props = Readonly<{
  goal: GoalProgress
  propertyId: string
  context: GoalCardContext
}>

export function PortalGroupGoalCard({ goal, propertyId, context }: Props) {
  const view = goalCardView(goal, context)
  return (
    <article aria-label={view.title} className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-medium">{view.title}</h3>
      {view.figure === null ? null : (
        <p className="mt-3 flex items-baseline gap-1.5">
          <span className="text-3xl font-semibold tracking-tight tabular-nums">
            {view.figure}
          </span>
          <span className="text-sm text-muted-foreground">{view.target} so far</span>
        </p>
      )}
      {view.fraction === null ? null : (
        <div
          role="progressbar"
          aria-label={view.progressLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(view.fraction * 100)}
          className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full origin-left rounded-full bg-foreground/70"
            style={{ transform: `scaleX(${view.fraction})` }}
          />
        </div>
      )}
      {view.detail === null ? null : (
        <p className="mt-3 text-sm text-muted-foreground">{view.detail}</p>
      )}
      {view.note === '' ? null : (
        <p className="mt-2 text-xs text-muted-foreground">{view.note}</p>
      )}
      <Link
        to="/properties/$propertyId/goals/$goalId"
        params={{ propertyId, goalId: goal.programId }}
        className="mt-3 inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-8"
      >
        Open in Goals
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
    </article>
  )
}
