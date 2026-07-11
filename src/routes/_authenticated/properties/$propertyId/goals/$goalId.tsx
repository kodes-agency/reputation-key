// Goal detail route — loads goal with progress and instances
import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { getGoal } from '#/contexts/goal/server/goals'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { cancelGoal } from '#/contexts/goal/server/goals'
import { GoalDetailPage } from '#/components/features/property/goals/goal-detail-page'
import { goalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/shared/queries/route-queries'

const goalQuery = (goalId: string) =>
  queryOptions({
    queryKey: goalKeys.detail(goalId),
    queryFn: () => getGoal({ data: { goalId } }),
    staleTime: 30_000,
  })

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
  loader: async ({ params: { goalId }, context }) => {
    const result = await context.queryClient.ensureQueryData(goalQuery(goalId))
    return result
  },
  component: GoalDetailRoute,
})

function GoalDetailRoute() {
  const { propertyId, goalId } = Route.useParams()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: goalData } = useSuspenseQuery(goalQuery(goalId))
  const { goal, progress, instances } = goalData

  const cancelMutation = useActionMutation(cancelGoal, {
    successMessage: 'Goal cancelled',
    invalidateKeys: [goalKeys.all],
  })

  return (
    <GoalDetailPage
      goal={goal}
      progress={progress ?? null}
      instances={instances ?? []}
      propertyId={propertyId}
      propertyName={propData.property.name}
      onCancel={() => cancelMutation({ data: { goalId } })}
      isCancelling={cancelMutation.isPending}
    />
  )
}
