// Create goal route — renders form with mutation
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { createGoal } from '#/contexts/goal/server/goals'
import { listPortals } from '#/contexts/portal/server/portals'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { GoalCreateForm } from '#/components/features/property/goals/goal-create-form'
import { PageShell } from '#/components/layout/page-shell'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals/new')({
  beforeLoad: ({ context }) => {
    const role = (context as AuthRouteContext).role
    if (!can(role, 'goal.create')) {
      throw redirect({ to: '/properties' })
    }
  },
  loader: async ({ params: { propertyId } }) => {
    const [{ portals }, { groups }] = await Promise.all([
      listPortals({ data: { propertyId } }),
      listPortalGroups({ data: { propertyId } }),
    ])
    return { portals, portalGroups: groups }
  },
  component: CreateGoalPage,
})

function CreateGoalPage() {
  const { propertyId } = Route.useParams()
  const { portals, portalGroups } = Route.useLoaderData()
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
    <PageShell>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">New Goal</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define a performance goal to track progress.
        </p>
      </div>
      <GoalCreateForm
        propertyId={propertyId}
        mutation={mutation}
        portals={portals}
        portalGroups={portalGroups}
      />
    </PageShell>
  )
}
