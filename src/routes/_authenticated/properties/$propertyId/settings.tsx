import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { propertyKeys, identityKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { listMembers } from '#/contexts/identity/server/organizations'
import {
  listPropertyResponsibleManagers,
  updatePropertyResponsibleManagers,
} from '#/contexts/property/server/property-responsible-managers'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { PropertyResponsibleManagersCard } from '#/components/features/property/property-responsible-managers-card'

const responsibleManagersQuery = (propertyId: string) =>
  queryOptions({
    queryKey: propertyKeys.responsibleManagers(propertyId),
    queryFn: () => listPropertyResponsibleManagers({ data: { propertyId } }),
    staleTime: 30_000,
  })

const membersQuery = queryOptions({
  queryKey: identityKeys.members(),
  queryFn: () => listMembers(),
  staleTime: 30_000,
})

export const Route = createFileRoute('/_authenticated/properties/$propertyId/settings')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'property.read')) throw redirect({ to: '/properties' })
  },
  staleTime: 30_000,
  loader: async ({ params: { propertyId }, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(propertyQuery(propertyId)),
      context.queryClient.ensureQueryData(responsibleManagersQuery(propertyId)),
      context.queryClient.ensureQueryData(membersQuery),
    ])
  },
  component: PropertySettingsRoute,
})

function PropertySettingsRoute() {
  const { propertyId } = Route.useParams()
  const { role } = Route.useRouteContext() as AuthRouteContext
  const { data: propertyData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: responsibleManagers } = useSuspenseQuery(
    responsibleManagersQuery(propertyId),
  )
  const { data: membersData } = useSuspenseQuery(membersQuery)
  const updateAction = useActionMutation(updatePropertyResponsibleManagers, {
    successMessage: 'Responsible managers updated',
    invalidateKeys: [
      propertyKeys.detail(propertyId),
      propertyKeys.responsibleManagers(propertyId),
    ],
  })

  return (
    <PageShell>
      <PageHeader
        title="Property settings"
        description={propertyData.property.name}
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propertyData.property.name, to: `/properties/${propertyId}` },
          { label: 'Settings' },
        ]}
      />
      <PropertyResponsibleManagersCard
        propertyId={propertyId}
        state={responsibleManagers}
        members={membersData.members}
        updateAction={updateAction}
        disabled={!can(role, 'property.update')}
      />
    </PageShell>
  )
}
