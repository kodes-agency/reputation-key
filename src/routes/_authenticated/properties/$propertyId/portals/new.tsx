// Create portal — route defines mutation, renders form component.
import { createFileRoute, useNavigate, useRouter, redirect } from '@tanstack/react-router'
import { createPortal } from '#/contexts/portal/server/portals'
import { PortalCreationWithPreview } from '#/components/features/portal'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { useMutationAction } from '#/components/hooks/use-mutation-action'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/new',
)({
  beforeLoad: ({ context }) => {
    const role = (context as AuthRouteContext).role
    if (!can(role, 'portal.create')) {
      throw redirect({ to: '/properties' })
    }
  },
  component: CreatePortalPage,
})

function CreatePortalPage() {
  const { propertyId } = Route.useParams()
  const navigate = useNavigate()
  const router = useRouter()

  const mutation = useMutationAction(createPortal, {
    successMessage: 'Portal created',
    onSuccess: async (output) => {
      await router.invalidate()
      await navigate({
        to: '/properties/$propertyId/portals/$portalId',
        params: { propertyId, portalId: output.portal.id },
      })
    },
  })

  return (
    <div className="mx-auto max-w-2xl">
      <PortalCreationWithPreview propertyId={propertyId} mutation={mutation} />
    </div>
  )
}
