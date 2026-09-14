import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { PropertyResponsibleManagersCard } from '#/components/features/property/property-responsible-managers-card'
import { updatePropertyResponsibleManagers } from '#/contexts/property/server/property-responsible-managers'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { propertyKeys } from '#/shared/queries/query-keys'
import { membersQuery, responsibleManagersQuery } from '../-settings-queries'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/settings/people',
)({
  loader: ({ params: { propertyId }, context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(responsibleManagersQuery(propertyId)),
      context.queryClient.ensureQueryData(membersQuery),
    ]),
  component: PropertyPeopleSettings,
})

function PropertyPeopleSettings() {
  const { propertyId } = Route.useParams()
  const { role } = Route.useRouteContext() as AuthRouteContext
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
    <PropertyResponsibleManagersCard
      propertyId={propertyId}
      state={responsibleManagers}
      members={membersData.members}
      updateAction={updateAction}
      disabled={!can(role, 'property.update')}
    />
  )
}
