// People route — thin wrapper around PeoplePage component
import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import {
  archiveStaffParticipation,
  createStaffParticipation,
  listStaffParticipations,
  updatePortalResponsibilities,
} from '#/contexts/staff/server/staff-participations'
import {
  createTeam,
  deleteTeam,
  listTeamMemberships,
  listTeams,
} from '#/contexts/team/server/teams'
import { listMembers } from '#/contexts/identity/server/organizations'
import { listPortals } from '#/contexts/portal/server/portals'
import { isDarkCapabilityDenial } from '#/shared/auth/capability-denial'
import {
  PeoplePage,
  peopleSearchSchema,
} from '#/components/features/property/people/people-page'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import {
  staffKeys,
  identityKeys,
  teamKeys,
  portalKeys,
  propertyKeys,
} from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'

const participationsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: staffKeys.participations(propertyId),
    queryFn: () => listStaffParticipations({ data: { propertyId, activeOnly: false } }),
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

const membershipsQuery = (propertyId: string, teamIds: readonly string[]) =>
  queryOptions({
    queryKey: [...teamKeys.list(propertyId), 'memberships', teamIds] as const,
    queryFn: async () => {
      const results = await Promise.all(
        teamIds.map((teamId) => listTeamMemberships({ data: { teamId } })),
      )
      return {
        memberships: results.flatMap((result) => result.memberships),
      }
    },
    staleTime: 30_000,
  })
const portalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.list(propertyId),
    // F-PEOPLE (BQC-6.7): portal.read is dark in the beta posture, and this
    // query's denial must not sink the ENABLED Staff/Teams/Directory surface
    // (Promise.all on the raw query rejected the whole loader → route 500).
    // Degrade to "no portals, portal affordances hidden" on a deliberate
    // dark-capability denial; REAL errors still throw and fail the loader.
    queryFn: async () => {
      try {
        const { portals } = await listPortals({ data: { propertyId } })
        return { portals, portalsDenied: false }
      } catch (e) {
        if (isDarkCapabilityDenial(e)) {
          return { portals: [], portalsDenied: true }
        }
        throw e
      }
    },
    staleTime: 30_000,
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/people')({
  beforeLoad: async ({ context, params }) => {
    await gateControlledRoute({
      data: {
        capability: 'staff.use',
        featureLabel: 'People',
        propertyId: params.propertyId,
      },
    })
    const { role } = context as AuthRouteContext
    if (!can(role, 'staff.read')) throw redirect({ to: '/properties' })
  },
  validateSearch: (search) => peopleSearchSchema.parse(search),
  staleTime: 30_000,
  loader: async ({ params: { propertyId }, context }) => {
    const [
      { participations, responsibilities },
      { members },
      { teams },
      { portals, portalsDenied },
    ] = await Promise.all([
      context.queryClient.ensureQueryData(participationsQuery(propertyId)),
      context.queryClient.ensureQueryData(membersQuery),
      context.queryClient.ensureQueryData(teamsQuery(propertyId)),
      context.queryClient.ensureQueryData(portalsQuery(propertyId)),
    ])
    const { memberships } = await context.queryClient.ensureQueryData(
      membershipsQuery(
        propertyId,
        teams.map((team) => team.id),
      ),
    )
    return {
      participations,
      responsibilities,
      memberships,
      members,
      teams,
      portals,
      portalsDenied,
    }
  },
  component: PeopleRoute,
})

function PeopleRoute() {
  const { propertyId } = Route.useParams()
  const { role } = Route.useRouteContext() as AuthRouteContext
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: participationData } = useSuspenseQuery(participationsQuery(propertyId))
  const { data: membersData } = useSuspenseQuery(membersQuery)
  const { data: teamsData } = useSuspenseQuery(teamsQuery(propertyId))
  const { data: membershipsData } = useSuspenseQuery(
    membershipsQuery(
      propertyId,
      teamsData.teams.map((team) => team.id),
    ),
  )
  const { data: portalsData } = useSuspenseQuery(portalsQuery(propertyId))
  const { participations, responsibilities } = participationData
  const { memberships } = membershipsData
  const { members } = membersData
  const { teams } = teamsData
  const { portals, portalsDenied } = portalsData
  const search = Route.useSearch() as { tab?: string }
  const navigate = Route.useNavigate()

  const invalidateKeys = [
    staffKeys.participations(propertyId),
    teamKeys.list(propertyId),
    propertyKeys.detail(propertyId),
  ]

  const createParticipationMutation = useActionMutation(createStaffParticipation, {
    invalidateKeys,
  })
  const archiveParticipationMutation = useActionMutation(archiveStaffParticipation, {
    successMessage: 'Staff participation archived',
    invalidateKeys,
  })
  const createTeamMutation = useActionMutation(createTeam, {
    successMessage: 'Team created',
    invalidateKeys,
  })
  const archiveTeamMutation = useActionMutation(deleteTeam, {
    successMessage: 'Team archived',
    invalidateKeys,
  })
  const updateResponsibilitiesMutation = useActionMutation(updatePortalResponsibilities, {
    invalidateKeys,
  })

  return (
    <PeoplePage
      propertyId={propertyId}
      propertyName={propData.property.name}
      participations={participations}
      responsibilities={responsibilities}
      memberships={memberships}
      members={members}
      teams={teams}
      portals={portals}
      portalsDenied={portalsDenied}
      canManageStaff={can(role, 'staff.manage')}
      tab={search.tab}
      onTabChange={(t) => navigate({ search: { tab: t } })}
      createParticipationMutation={createParticipationMutation}
      archiveParticipationMutation={archiveParticipationMutation}
      createTeamMutation={createTeamMutation}
      archiveTeamMutation={archiveTeamMutation}
      updateResponsibilitiesMutation={updateResponsibilitiesMutation}
    />
  )
}
