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
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { listTeams } from '#/contexts/team/server/teams'
import { listStaffAssignments } from '#/contexts/staff/server/staff-assignments'
import { listMembers } from '#/contexts/identity/server/organizations'
import { toMemberOptions } from '#/lib/lookups'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { Settings, Users } from 'lucide-react'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'

const teamRouteApi = getRouteApi('/_authenticated/properties/$propertyId/teams/$teamId')
const propertyRoute = getRouteApi('/_authenticated/properties/$propertyId')

export function useTeamLayout() {
  return teamRouteApi.useLoaderData()
}

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/teams/$teamId',
)({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'team.read')) throw redirect({ to: '/properties' })
  },
  staleTime: 30_000,
  loader: async ({ params }) => {
    const [{ teams }, { members }, { assignments }] = await Promise.all([
      listTeams({ data: { propertyId: params.propertyId } }),
      listMembers(),
      listStaffAssignments({ data: { propertyId: params.propertyId } }),
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

function TeamLayout() {
  const { team, propertyId, teamId } = Route.useLoaderData()
  const { property } = propertyRoute.useLoaderData()
  const location = useLocation()
  const navigate = useNavigate()
  const activeTab = location.pathname.endsWith('/members') ? 'members' : 'settings'

  return (
    <PageShell>
      <PageHeader
        title={team.name}
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: property.name, to: `/properties/${propertyId}` },
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
