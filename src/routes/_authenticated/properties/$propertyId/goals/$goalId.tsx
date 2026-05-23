// Goal detail route — loads goal with progress and instances
import { createFileRoute } from '@tanstack/react-router'
import { getGoal } from '#/contexts/goal/server/goals'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { cancelGoal } from '#/contexts/goal/server/goals'
import { GoalDetailPage } from '#/components/features/property/goals/goal-detail-page'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/goals/$goalId',
)({
  staleTime: 30_000,
  loader: async ({ params: { goalId } }) => {
    const result = await getGoal({ data: { goalId } })
    return result
  },
  component: GoalDetailRoute,
})

function GoalDetailRoute() {
  const { propertyId, goalId } = Route.useParams()
  const { goal, progress, instances } = Route.useLoaderData()

  const cancelMutation = useMutationAction(cancelGoal, {
    successMessage: 'Goal cancelled',
    invalidateRoutes: ['/_authenticated/properties/$propertyId/goals'],
  })

  return (
    <div className="mx-auto max-w-3xl">
      <GoalDetailPage
        goal={goal}
        progress={progress ?? null}
        instances={instances ?? []}
        propertyId={propertyId}
        onCancel={() => cancelMutation({ data: { goalId } })}
        isCancelling={cancelMutation.isPending}
      />
    </div>
  )
}
