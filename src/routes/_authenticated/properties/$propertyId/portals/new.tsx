// Create portal — route defines mutation, renders form component.
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createPortal } from '#/contexts/portal/server/portals'
import { PortalCreationWithPreview } from '#/components/features/portal'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { portalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { ErrorState, LoadingState } from '#/components/layout/page-states'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/new',
)({
  beforeLoad: async ({ context, params }) => {
    await gateControlledRoute({
      data: {
        capability: 'portal.write',
        featureLabel: 'Portals',
        propertyId: params.propertyId,
      },
    })
    const role = (context as AuthRouteContext).role
    if (!can(role, 'portal.create')) {
      throw redirect({ to: '/properties' })
    }
  },
  loader: async ({ params, context }) => {
    await context.queryClient.ensureQueryData(propertyQuery(params.propertyId))
  },
  pendingComponent: CreatePortalLoading,
  errorComponent: CreatePortalError,
  component: CreatePortalPage,
})

function CreatePortalLoading() {
  return (
    <PageShell>
      <LoadingState label="Loading portal editor" />
    </PageShell>
  )
}

function CreatePortalError({ error }: { error: Error }) {
  return (
    <PageShell>
      <PageHeader
        title="New Portal"
        description="Create a public page for this property."
      />
      <ErrorState message={error.message || 'The portal editor could not be loaded.'} />
    </PageShell>
  )
}

function CreatePortalPage() {
  const { propertyId } = Route.useParams()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { property } = propData
  const navigate = useNavigate()

  const mutation = useActionMutation(createPortal, {
    successMessage: 'Portal created',
    invalidateKeys: [portalKeys.all],
    onSuccess: async (output) => {
      await navigate({
        to: '/properties/$propertyId/portals/$portalId',
        params: { propertyId, portalId: output.portal.id },
        search: { tab: 'settings' },
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
