// Team detail layout — loads shared data, renders tabs, delegates content to child routes
import {
  createFileRoute,
  getRouteApi,
  notFound,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { listTeams } from '#/contexts/team/server/teams'
import { listStaffAssignments } from '#/contexts/staff/server/staff-assignments'
import { listMembers } from '#/contexts/identity/server/organizations'
import { toMemberOptions } from '#/lib/lookups'
import { teamKeys, identityKeys, staffKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { Settings, Users } from 'lucide-react'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { gateDarkRoute } from '#/shared/auth/dark-route-gate'

const teamRouteApi = getRouteApi('/_authenticated/properties/$propertyId/teams/$teamId')

const teamsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: teamKeys.list(propertyId),
    queryFn: () => listTeams({ data: { propertyId } }),
    staleTime: 30_000,
  })

const membersQuery = queryOptions({
  queryKey: identityKeys.members(),
  queryFn: () => listMembers(),
  staleTime: 30_000,
})

const assignmentsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: staffKeys.assignments(propertyId),
    queryFn: () => listStaffAssignments({ data: { propertyId } }),
    staleTime: 30_000,
  })

export function useTeamLayout() {
  const { propertyId, teamId } = teamRouteApi.useParams()
  const { data: teamsData } = useSuspenseQuery(teamsQuery(propertyId))
  const { data: membersData } = useSuspenseQuery(membersQuery)
  const { data: assignmentsData } = useSuspenseQuery(assignmentsQuery(propertyId))
  const { teams } = teamsData
  const { members } = membersData
  const { assignments: allAssignments } = assignmentsData
  const team = teams.find((t) => t.id === teamId)
  if (!team) throw notFound()
  const teamAssignments = allAssignments.filter((a) => a.teamId === teamId)
  const memberOptions = toMemberOptions(members)
  return {
    team,
    memberOptions,
    assignments: teamAssignments,
    propertyId,
    teamId,
  }
}

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/teams/$teamId',
)({
  beforeLoad: async ({ context }) => {
    await gateDarkRoute({ data: { capability: 'team.use', featureLabel: 'Teams' } })
    const { role } = context as AuthRouteContext
    if (!can(role, 'team.read')) throw redirect({ to: '/properties' })
  },
  staleTime: 30_000,
  loader: async ({ params, context }) => {
    const [{ teams }, { members }, { assignments }] = await Promise.all([
      context.queryClient.ensureQueryData(teamsQuery(params.propertyId)),
      context.queryClient.ensureQueryData(membersQuery),
      context.queryClient.ensureQueryData(assignmentsQuery(params.propertyId)),
    ])
    const team = teams.find((t) => t.id === params.teamId)
    if (!team) throw notFound()
    const teamAssignments = assignments.filter((a) => a.teamId === params.teamId)
    const memberOptions = toMemberOptions(members)
    return {
      team,
      memberOptions,
      assignments: teamAssignments,
      propertyId: params.propertyId,
      teamId: params.teamId,
    }
  },
  component: TeamLayout,
})

// fallow-ignore-next-line complexity — pre-existing component on main (BQC-2.6 touched only this file's beforeLoad gate, not the component)
function TeamLayout() {
  const { team, propertyId, teamId } = useTeamLayout()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const location = useLocation()
  const navigate = useNavigate()
  const activeTab = location.pathname.endsWith('/members') ? 'members' : 'settings'

  return (
    <PageShell>
      <PageHeader
        title={team.name}
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propData.property.name, to: `/properties/${propertyId}` },
          { label: 'People', to: `/properties/${propertyId}/people` },
          { label: team.name },
        ]}
        backTo={{
          to: `/properties/${propertyId}/people`,
          label: 'Back to People',
        }}
      />

      <Tabs
        value={activeTab}
        onValueChange={(tab) => {
          const routes: Record<string, string> = {
            settings: '/properties/$propertyId/teams/$teamId',
            members: '/properties/$propertyId/teams/$teamId/members',
          }
          navigate({
            to: routes[tab],
            params: { propertyId, teamId },
          })
        }}
      >
        <TabsList>
          <TabsTrigger value="settings">
            <Settings className="size-3.5" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="members">
            <Users className="size-3.5" />
            Members
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <Outlet />
    </PageShell>
  )
}
