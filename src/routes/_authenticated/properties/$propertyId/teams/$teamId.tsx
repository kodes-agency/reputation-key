// Team detail layout — loads shared data, renders tabs, delegates content to child routes
import {
  createFileRoute,
  getRouteApi,
  Link,
  Outlet,
  useLocation,
  useNavigate,
} from '@tanstack/react-router'
import { listTeams } from '#/contexts/team/server/teams'
import { listStaffAssignments } from '#/contexts/staff/server/staff-assignments'
import { listMembers } from '#/contexts/identity/server/organizations'
import { toMemberOptions } from '#/lib/lookups'
import { Button } from '#/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { ArrowLeft, Settings, Users } from 'lucide-react'

const teamRouteApi = getRouteApi('/_authenticated/properties/$propertyId/teams/$teamId')

export function useTeamLayout() {
  return teamRouteApi.useLoaderData()
}

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/teams/$teamId',
)({
  staleTime: 30_000,
  loader: async ({ params }) => {
    const [{ teams }, { members }, { assignments }] = await Promise.all([
      listTeams({ data: { propertyId: params.propertyId } }),
      listMembers(),
      listStaffAssignments({ data: { propertyId: params.propertyId } }),
    ])
    const team = teams.find((t: { id: string }) => t.id === params.teamId)
    if (!team) throw new Error('Team not found')
    const teamAssignments = assignments.filter(
      (a: { teamId: string | null }) => a.teamId === params.teamId,
    )
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
  const { propertyId, teamId } = Route.useLoaderData()
  const location = useLocation()
  const navigate = useNavigate()
  const activeTab = location.pathname.endsWith('/members') ? 'members' : 'settings'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" asChild>
          <Link to="/properties/$propertyId/teams" params={{ propertyId }}>
            <ArrowLeft />
            Back
          </Link>
        </Button>
      </div>

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
    </div>
  )
}
