import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { PropertyLifecycleCard } from '#/components/features/property/property-lifecycle-card'
import {
  removePropertyFromWorkspace,
  type RemovePropertyInput,
} from '#/components/features/property/remove-property-from-workspace'
import {
  archiveProperty,
  disconnectPropertyGoogleBinding,
  restoreProperty,
} from '#/contexts/property/server/properties'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { can } from '#/shared/domain/permissions'
import { propertyKeys } from '#/shared/queries/query-keys'
import { responsibleManagersQuery } from '../-settings-queries'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/settings/danger',
)({
  loader: ({ params: { propertyId }, context }) =>
    context.queryClient.ensureQueryData(responsibleManagersQuery(propertyId)),
  component: PropertyDangerSettings,
})

function PropertyDangerSettings() {
  const { propertyId } = Route.useParams()
  const { role } = Route.useRouteContext() as AuthRouteContext
  const { data } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: responsibleManagers } = useSuspenseQuery(
    responsibleManagersQuery(propertyId),
  )
  const invalidateKeys = [propertyKeys.detail(propertyId), propertyKeys.list()]
  const archive = useActionMutation(archiveProperty, {
    successMessage: 'Property archived. Its settings and history are retained.',
    invalidateKeys,
  })
  const restore = useActionMutation(restoreProperty, {
    invalidateKeys,
    onSuccess: (result) => {
      if (result.googleBindingReadiness === 'reconnect_required') {
        toast.success(
          'Property restored. Reconnect Google before restarting provider work.',
        )
      } else {
        toast.success('Property restored. Google is ready for this Property.')
      }
    },
  })
  const remove = useActionMutation(
    (input: RemovePropertyInput) =>
      removePropertyFromWorkspace(input, {
        archive: archiveProperty,
        disconnect: disconnectPropertyGoogleBinding,
      }),
    {
      invalidateKeys,
      onSuccess: (result) => {
        if (result.googleDisconnected) {
          toast.success(
            'Property removed. Restore it from the Removed list within 30 days.',
          )
        } else {
          toast.warning(
            'Property removed, but its Google connection could not be disconnected. Open the Property to disconnect it.',
          )
        }
      },
    },
  )
  const disconnect = useActionMutation(disconnectPropertyGoogleBinding, {
    successMessage:
      'This Property is disconnected. The Organization Google connection is unchanged.',
    invalidateKeys,
  })

  return (
    <PropertyLifecycleCard
      property={data.property}
      responsibilityNeeded={responsibleManagers.responsibilityNeeded}
      actions={{ archive, remove, restore, disconnect }}
      permissions={{
        archive: can(role, 'property.archive'),
        restore: can(role, 'property.restore'),
        disconnect: can(role, 'property.disconnect'),
      }}
    />
  )
}
