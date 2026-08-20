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
import { Settings, Users } from 'lucide-react'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { listTeams, listTeamMemberships } from '#/contexts/team/server/teams'
import { teamKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { ErrorState, LoadingState } from '#/components/layout/page-states'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'

const teamRouteApi = getRouteApi('/_authenticated/properties/$propertyId/teams/$teamId')

const teamsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: teamKeys.list(propertyId),
    queryFn: () => listTeams({ data: { propertyId } }),
    staleTime: 30_000,
  })

export const teamMembershipsQueryKey = (teamId: string) =>
  ['team-memberships', teamId] as const

const membershipsQuery = (teamId: string) =>
  queryOptions({
    queryKey: teamMembershipsQueryKey(teamId),
    queryFn: () => listTeamMemberships({ data: { teamId } }),
    staleTime: 30_000,
  })

export function useTeamLayout() {
  const { propertyId, teamId } = teamRouteApi.useParams()
  const { data: teamsData } = useSuspenseQuery(teamsQuery(propertyId))
  const { data: membershipsData } = useSuspenseQuery(membershipsQuery(teamId))
  const team = teamsData.teams.find((candidate) => candidate.id === teamId)
  if (!team) throw notFound()

  return {
    team,
    memberships: membershipsData.memberships,
    availableParticipations: membershipsData.availableParticipations,
    propertyId,
    teamId,
  }
}

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/teams/$teamId',
)({
  beforeLoad: async ({ context, params }) => {
    await gateControlledRoute({
      data: {
        capability: 'team.use',
        featureLabel: 'Teams',
        propertyId: params.propertyId,
      },
    })
    const { role } = context as AuthRouteContext
    if (!can(role, 'team.read')) throw redirect({ to: '/properties' })
  },
  staleTime: 30_000,
  loader: async ({ params, context }) => {
    const [{ teams }, { memberships, availableParticipations }] = await Promise.all([
      context.queryClient.ensureQueryData(teamsQuery(params.propertyId)),
      context.queryClient.ensureQueryData(membershipsQuery(params.teamId)),
    ])
    const team = teams.find((candidate) => candidate.id === params.teamId)
    if (!team) throw notFound()
    return {
      team,
      memberships,
      availableParticipations,
      propertyId: params.propertyId,
      teamId: params.teamId,
    }
  },
  pendingComponent: TeamDetailLoading,
  errorComponent: TeamDetailError,
  component: TeamLayout,
})

function TeamDetailLoading() {
  return (
    <PageShell>
      <LoadingState label="Loading team details" />
    </PageShell>
  )
}

function TeamDetailError({ error }: { error: Error }) {
  return (
    <PageShell>
      <PageHeader title="Team" description="Manage team details and membership." />
      <ErrorState message={error.message || 'This team could not be loaded.'} />
    </PageShell>
  )
}

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
        description={team.description ?? 'Manage this team and its effective membership.'}
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
          navigate({ to: routes[tab], params: { propertyId, teamId } })
        }}
      >
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="settings">
            <Settings className="size-3.5" aria-hidden="true" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="members">
            <Users className="size-3.5" aria-hidden="true" />
            Members
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <Outlet />
    </PageShell>
  )
}
