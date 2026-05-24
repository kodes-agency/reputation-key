// Goal detail route — loads goal with progress and instances
import { createFileRoute, redirect } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { getGoal } from '#/contexts/goal/server/goals'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { cancelGoal } from '#/contexts/goal/server/goals'
import { GoalDetailPage } from '#/components/features/property/goals/goal-detail-page'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/goals/$goalId',
)({
  beforeLoad: ({ context }) => {
    const role = (context as AuthRouteContext).role
    if (!can(role, 'goal.read')) {
      throw redirect({ to: '/properties' })
    }
  },
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
