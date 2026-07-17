// Portal list — shows all portals for a property
import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { listPortals, deletePortal } from '#/contexts/portal/server/portals'
import { PortalListPage } from '#/components/features/portal/portal-list-page'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { portalKeys } from '#/shared/queries/query-keys'
import { propertiesQuery } from '#/shared/queries/route-queries'
import { gateDarkRoute } from '#/shared/auth/dark-route-gate'

const portalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.list(propertyId),
    queryFn: () => listPortals({ data: { propertyId } }),
    staleTime: 30_000,
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/portals/')({
  beforeLoad: async ({ context }) => {
    await gateDarkRoute('portal.read', 'Portals')
    const { role } = context as AuthRouteContext
    if (!can(role, 'portal.read')) throw redirect({ to: '/properties' })
  },
  staleTime: 30_000,
  loader: async ({ params, context }) => {
    const { portals } = await context.queryClient.ensureQueryData(
      portalsQuery(params.propertyId),
    )
    return {
      portals,
      propertyId: params.propertyId,
    }
  },
  component: PortalListRoute,
})

function PortalListRoute() {
  const { propertyId } = Route.useParams()
  const { data: portalsData } = useSuspenseQuery(portalsQuery(propertyId))
  const { data: propsData } = useSuspenseQuery(propertiesQuery)
  const { portals } = portalsData
  const { properties } = propsData
  const property = properties?.find((p) => p.id === propertyId)
  const propertySlug = property?.slug ?? ''
  const propertyName = property?.name ?? ''

  const deleteMutation = useActionMutation(deletePortal, {
    successMessage: 'Portal deleted',
    invalidateKeys: [portalKeys.list(propertyId), portalKeys.all],
  })

  return (
    <PortalListPage
      portals={portals}
      propertyId={propertyId}
      propertyName={propertyName}
      propertySlug={propertySlug}
      deleteMutation={deleteMutation}
    />
  )
}
