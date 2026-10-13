import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
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
  const queryClient = useQueryClient()
  const updateAction = useActionMutation(updatePropertyResponsibleManagers, {
    successMessage: 'Responsible managers saved',
    invalidateKeys: [
      propertyKeys.detail(propertyId),
      propertyKeys.responsibleManagers(propertyId),
    ],
    // A refused save means another admin changed the managers since this page
    // read them. The card keeps the refused edit and Reset is the way out, but
    // Reset shows that change only once the page has read it, and nothing else
    // reads it soon (the read is fresh for 30 seconds). So the managers are
    // re-read: those of the Property the command named, because this route is
    // not remounted when its params change.
    onError: (_error, input) =>
      void queryClient.invalidateQueries({
        queryKey: propertyKeys.responsibleManagers(input.data.propertyId),
      }),
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
