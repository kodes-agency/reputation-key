// The "Goal" column of a group's page: the goals that target this group, each as
// a card, or the way to set one. Never holds the page back: it is a side read
// that may be off for this reader, still loading, or failed.
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import type { GoalProgress } from '#/contexts/reporting/application/public-api'
import { PortalGroupGoalCard } from './portal-group-goal-card'
import type { GoalCardContext } from './portal-group-goal-view'
import type { ReadState } from './portal-group-read-state'

type Props = Readonly<{
  state: ReadState<readonly GoalProgress[]>
  propertyId: string
  groupId: string
  context: GoalCardContext
  canSetGoal: boolean
  onRetry: () => void
}>

export function PortalGroupGoals({
  state,
  propertyId,
  groupId,
  context,
  canSetGoal,
  onRetry,
}: Props) {
  if (state.status === 'off') return null
  return (
    <section aria-labelledby="group-goal-heading" className="flex flex-col gap-3">
      <h2 id="group-goal-heading" className="text-base font-semibold">
        Goal
      </h2>
      {state.status === 'loading' ? (
        <div aria-busy="true" className="rounded-lg border p-4">
          <span className="sr-only">Loading the goal</span>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-4 h-8 w-24" />
          <Skeleton className="mt-4 h-2 w-full" />
        </div>
      ) : null}
      {state.status === 'failed' ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3"
        >
          <p className="text-sm text-muted-foreground">The goal couldn’t be loaded.</p>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 md:min-h-8"
            onClick={onRetry}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {state.status === 'ready' && state.data.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4">
          <p className="text-sm text-muted-foreground">
            No goal for this group yet. A goal is a monthly target the group’s portals
            share.
          </p>
          {canSetGoal ? (
            <Link
              to="/properties/$propertyId/goals/new"
              params={{ propertyId }}
              search={{ subject: `portal_group:${groupId}` }}
              className="mt-2 inline-flex min-h-11 items-center rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-8"
            >
              Set a goal
            </Link>
          ) : null}
        </div>
      ) : null}
      {state.status === 'ready'
        ? state.data.map((goal) => (
            <PortalGroupGoalCard
              key={goal.programId}
              goal={goal}
              propertyId={propertyId}
              context={context}
            />
          ))
        : null}
    </section>
  )
}
