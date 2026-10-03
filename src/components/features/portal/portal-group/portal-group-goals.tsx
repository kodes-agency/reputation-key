// fallow-ignore-file code-duplication
// r4 s38: parallel dialog forms, server-function shells and ledger rows share intentional boilerplate.
// The "Goal" column of a group's page: the goals that target this group, each as
// a card, or the way to set one. Never holds the page back: it is a side read
// that may be off for this reader, still loading, or failed.
import { Link } from '@tanstack/react-router'
import { Target } from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'
import { RegionError } from '#/components/ui/region-error'
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
        <RegionError
          size="compact"
          message="The goal couldn’t be loaded."
          onRetry={onRetry}
        />
      ) : null}
      {state.status === 'ready' && state.data.length === 0 ? (
        <EmptyState
          size="compact"
          icon={Target}
          title="No goal for this group yet"
          description="A goal is a monthly target the group’s portals share."
          action={
            canSetGoal ? (
              <Link
                to="/properties/$propertyId/goals/new"
                params={{ propertyId }}
                search={{ subject: `portal_group:${groupId}` }}
                className="inline-flex min-h-11 items-center rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-8"
              >
                Set a goal
              </Link>
            ) : undefined
          }
        />
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
