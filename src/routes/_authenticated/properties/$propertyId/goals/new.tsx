// Create goal route — renders form with mutation
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { createGoal } from '#/contexts/goal/server/goals'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { GoalCreateForm } from '#/components/features/property/goals/goal-create-form'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals/new')({
  beforeLoad: ({ context }) => {
    const role = (context as AuthRouteContext).role
    if (!can(role, 'goal.create')) {
      throw redirect({ to: '/properties' })
    }
  },
  component: CreateGoalPage,
})

function CreateGoalPage() {
  const { propertyId } = Route.useParams()
  const navigate = useNavigate()

  const mutation = useMutationAction(createGoal, {
    successMessage: 'Goal created',
    invalidateRoutes: ['/_authenticated/properties/$propertyId/goals'],
    onSuccess: async (output) => {
      await navigate({
        to: '/properties/$propertyId/goals/$goalId',
        params: { propertyId, goalId: output.goal.id },
      })
    },
  })

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">New Goal</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define a performance goal to track progress.
        </p>
      </div>
      <GoalCreateForm propertyId={propertyId} mutation={mutation} />
    </div>
  )
}
