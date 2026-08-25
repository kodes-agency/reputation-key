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

const portalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.list(propertyId),
    // F-PEOPLE (BQC-6.7): portal.read is dark in the beta posture, and this
    // query's denial must not sink the ENABLED Staff/Directory surface
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
    const [{ participations, responsibilities }, { members }, portalResult] =
      await Promise.all([
        context.queryClient.ensureQueryData(participationsQuery(propertyId)),
        context.queryClient.ensureQueryData(membersQuery),
        context.queryClient.ensureQueryData(portalsQuery(propertyId)),
      ])
    return {
      participations,
      responsibilities,
      members,
      ...portalResult,
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
  const { data: portalsData } = useSuspenseQuery(portalsQuery(propertyId))
  const { participations, responsibilities } = participationData
  const { members } = membersData
  const { portals, portalsDenied } = portalsData
  const search = Route.useSearch() as { tab?: string }
  const navigate = Route.useNavigate()

  const invalidateKeys = [
    staffKeys.participations(propertyId),
    propertyKeys.detail(propertyId),
  ]

  const createParticipationMutation = useActionMutation(createStaffParticipation, {
    invalidateKeys,
  })
  const archiveParticipationMutation = useActionMutation(archiveStaffParticipation, {
    successMessage: 'Staff participation archived',
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
      members={members}
      portals={portals}
      portalsDenied={portalsDenied}
      canManageStaff={can(role, 'staff.manage')}
      tab={search.tab}
      onTabChange={(t) => navigate({ search: { tab: t } })}
      createParticipationMutation={createParticipationMutation}
      archiveParticipationMutation={archiveParticipationMutation}
      updateResponsibilitiesMutation={updateResponsibilitiesMutation}
    />
  )
}
