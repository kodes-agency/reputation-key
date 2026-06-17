// Create portal — route defines mutation, renders form component.
import {
  createFileRoute,
  useNavigate,
  getRouteApi,
  redirect,
} from '@tanstack/react-router'
import { createPortal } from '#/contexts/portal/server/portals'
import { PortalCreationWithPreview } from '#/components/features/portal'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'

const propertyRoute = getRouteApi('/_authenticated/properties/$propertyId')

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
  const { property } = propertyRoute.useLoaderData()
  const navigate = useNavigate()

  const mutation = useMutationAction(createPortal, {
    successMessage: 'Portal created',
    invalidateRoutes: ['/_authenticated/properties/$propertyId/portals/'],
    onSuccess: async (output) => {
      await navigate({
        to: '/properties/$propertyId/portals/$portalId',
        params: { propertyId, portalId: output.portal.id },
      })
    },
  })

  return (
    <PageShell>
      <PageHeader
        title="New Portal"
        description="Create a guest-facing portal page for this property."
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: property.name, to: `/properties/${propertyId}` },
          { label: 'Portals', to: `/properties/${propertyId}/portals` },
          { label: 'New Portal' },
        ]}
        backTo={{
          to: `/properties/${propertyId}/portals`,
          label: 'Back to Portals',
        }}
      />
      <PortalCreationWithPreview propertyId={propertyId} mutation={mutation} />
    </PageShell>
  )
}
