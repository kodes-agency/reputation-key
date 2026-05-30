// People route — thin wrapper around PeoplePage component
import { createFileRoute, redirect } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { listStaffAssignments } from '#/contexts/staff/server/staff-assignments'
import { listTeams } from '#/contexts/team/server/teams'
import { listMembers } from '#/contexts/identity/server/organizations'
import { PeoplePage, peopleSearchSchema } from '#/components/features/property/people/people-page'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/people')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'staff_assignment.read')) throw redirect({ to: '/properties' })
  },
  validateSearch: (search) => peopleSearchSchema.parse(search),
  staleTime: 30_000,
  loader: async ({ params: { propertyId } }) => {
    const [{ assignments }, { members }, { teams }] = await Promise.all([
      listStaffAssignments({ data: { propertyId } }),
      listMembers(),
      listTeams({ data: { propertyId } }),
    ])
    return { assignments, members, teams }
  },
  component: PeopleRoute,
})

function PeopleRoute() {
  const { propertyId } = Route.useParams()
  const { assignments, members, teams } = Route.useLoaderData()
  const { tab } = Route.useSearch()

  return (
    <PeoplePage
      propertyId={propertyId}
      assignments={assignments}
      members={members}
      teams={teams}
      tab={tab}
    />
  )
}
