// People route — thin wrapper around PeoplePage component
import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  listStaffAssignments,
  createStaffAssignment,
  removeStaffAssignment,
  updateStaffPortals,
} from '#/contexts/staff/server/staff-assignments'
import { listTeams, createTeam, deleteTeam } from '#/contexts/team/server/teams'
import { listMembers } from '#/contexts/identity/server/organizations'
import { listPortals } from '#/contexts/portal/server/portals'
import {
  PeoplePage,
  peopleSearchSchema,
} from '#/components/features/property/people/people-page'

const propertyRoute = getRouteApi('/_authenticated/properties/$propertyId')

export const Route = createFileRoute('/_authenticated/properties/$propertyId/people')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'staff_assignment.read')) throw redirect({ to: '/properties' })
  },
  validateSearch: (search) => peopleSearchSchema.parse(search),
  staleTime: 30_000,
  loader: async ({ params: { propertyId } }) => {
    const [{ assignments }, { members }, { teams }, { portals }] = await Promise.all([
      listStaffAssignments({ data: { propertyId } }),
      listMembers(),
      listTeams({ data: { propertyId } }),
      listPortals({ data: { propertyId } }),
    ])
    return { assignments, members, teams, portals }
  },
  component: PeopleRoute,
})

function PeopleRoute() {
  const { propertyId } = Route.useParams()
  const { property } = propertyRoute.useLoaderData()
  const { assignments, members, teams, portals } = Route.useLoaderData()
  const search = Route.useSearch() as { tab?: string }
  const navigate = Route.useNavigate()

  return (
    <PeoplePage
      propertyId={propertyId}
      propertyName={property.name}
      assignments={assignments}
      members={members}
      teams={teams}
      portals={portals}
      tab={search.tab}
      onTabChange={(t) => navigate({ search: { tab: t } })}
      createStaffAssignmentFn={createStaffAssignment}
      removeStaffAssignmentFn={removeStaffAssignment}
      createTeamFn={createTeam}
      deleteTeamFn={deleteTeam}
      updateStaffPortalsFn={updateStaffPortals}
    />
  )
}
