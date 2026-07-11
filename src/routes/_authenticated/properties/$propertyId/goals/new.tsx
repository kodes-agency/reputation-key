// Create goal route — renders form with mutation
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { createGoal } from '#/contexts/goal/server/goals'
import { listPortals } from '#/contexts/portal/server/portals'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { GoalCreateForm } from '#/components/features/property/goals/goal-create-form'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/shared/queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'

const portalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.list(propertyId),
    queryFn: () => listPortals({ data: { propertyId } }),
  })

const portalGroupsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.groups(propertyId),
    queryFn: () => listPortalGroups({ data: { propertyId } }),
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals/new')({
  beforeLoad: ({ context }) => {
    const role = (context as AuthRouteContext).role
    if (!can(role, 'goal.create')) {
      throw redirect({ to: '/properties' })
    }
  },
  loader: async ({ params: { propertyId }, context }) => {
    const [{ portals }, { groups }] = await Promise.all([
      context.queryClient.ensureQueryData(portalsQuery(propertyId)),
      context.queryClient.ensureQueryData(portalGroupsQuery(propertyId)),
    ])
    return { portals, portalGroups: groups }
  },
  component: CreateGoalPage,
})

function CreateGoalPage() {
  const { propertyId } = Route.useParams()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: portalsData } = useSuspenseQuery(portalsQuery(propertyId))
  const { data: groupsData } = useSuspenseQuery(portalGroupsQuery(propertyId))
  const { portals } = portalsData
  const portalGroups = groupsData.groups
  const navigate = useNavigate()

  const mutation = useActionMutation(createGoal, {
    successMessage: 'Goal created',
    invalidateKeys: [goalKeys.all],
    onSuccess: async (output) => {
      await navigate({
        to: '/properties/$propertyId/goals/$goalId',
        params: { propertyId, goalId: output.goal.id },
      })
    },
  })

  return (
    <PageShell tier="standard">
      <PageHeader
        title="New Goal"
        description="Define a performance goal to track progress."
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propData.property.name, to: `/properties/${propertyId}` },
          { label: 'Goals', to: `/properties/${propertyId}/goals` },
          { label: 'New Goal' },
        ]}
      />
      <GoalCreateForm
        propertyId={propertyId}
        propertyName={propData.property.name}
        mutation={mutation}
        portals={portals}
        portalGroups={portalGroups}
      />
    </PageShell>
  )
}
