// People route — thin wrapper around PeoplePage component
import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
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
import {
  staffKeys,
  identityKeys,
  teamKeys,
  portalKeys,
} from '#/shared/queries/query-keys'
import { propertyQuery } from '#/shared/queries/route-queries'

const assignmentsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: staffKeys.assignments(propertyId),
    queryFn: () => listStaffAssignments({ data: { propertyId } }),
    staleTime: 30_000,
  })

const membersQuery = queryOptions({
  queryKey: identityKeys.members(),
  queryFn: () => listMembers(),
  staleTime: 30_000,
})

const teamsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: teamKeys.list(propertyId),
    queryFn: () => listTeams({ data: { propertyId } }),
    staleTime: 30_000,
  })

const portalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.list(propertyId),
    queryFn: () => listPortals({ data: { propertyId } }),
    staleTime: 30_000,
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/people')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'staff_assignment.read')) throw redirect({ to: '/properties' })
  },
  validateSearch: (search) => peopleSearchSchema.parse(search),
  staleTime: 30_000,
  loader: async ({ params: { propertyId }, context }) => {
    const [{ assignments }, { members }, { teams }, { portals }] = await Promise.all([
      context.queryClient.ensureQueryData(assignmentsQuery(propertyId)),
      context.queryClient.ensureQueryData(membersQuery),
      context.queryClient.ensureQueryData(teamsQuery(propertyId)),
      context.queryClient.ensureQueryData(portalsQuery(propertyId)),
    ])
    return { assignments, members, teams, portals }
  },
  component: PeopleRoute,
})

function PeopleRoute() {
  const { propertyId } = Route.useParams()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: assignmentsData } = useSuspenseQuery(assignmentsQuery(propertyId))
  const { data: membersData } = useSuspenseQuery(membersQuery)
  const { data: teamsData } = useSuspenseQuery(teamsQuery(propertyId))
  const { data: portalsData } = useSuspenseQuery(portalsQuery(propertyId))
  const { assignments } = assignmentsData
  const { members } = membersData
  const { teams } = teamsData
  const { portals } = portalsData
  const search = Route.useSearch() as { tab?: string }
  const navigate = Route.useNavigate()

  return (
    <PeoplePage
      propertyId={propertyId}
      propertyName={propData.property.name}
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
