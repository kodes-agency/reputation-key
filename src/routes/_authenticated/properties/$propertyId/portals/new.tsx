// Create portal — route defines mutation, renders form component.
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router'
import { createPortal } from '#/contexts/portal/server/portals'
import { PortalCreationWithPreview } from '#/components/features/portal/PortalCreationWithPreview'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { hasRole } from '#/shared/domain/roles'
import { useMutationAction } from '#/components/hooks/use-mutation-action'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/new',
)({
  beforeLoad: ({ context }) => {
    const role = (context as AuthRouteContext).role
    if (!hasRole(role, 'PropertyManager')) {
      throw redirect({ to: '/properties' })
    }
  },
  component: CreatePortalPage,
})

function CreatePortalPage() {
  const { propertyId } = Route.useParams()
  const navigate = useNavigate()

  const mutation = useMutationAction(createPortal, {
    successMessage: 'Portal created',
    onSuccess: async (output) => {
      await navigate({
        to: '/properties/$propertyId/portals/$portalId',
        params: { propertyId, portalId: output.portal.id },
      })
    },
  })

  return <PortalCreationWithPreview propertyId={propertyId} mutation={mutation} />
}
