// Portal list — shows all portals for a property
import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { listPortals, deletePortal } from '#/contexts/portal/server/portals'
import {
  addPortalToGroup,
  createPortalGroup,
  listPortalGroups,
  removePortalFromGroup,
  softDeletePortalGroup,
  updatePortalGroup,
} from '#/contexts/portal/server/portal-groups'
import { PortalListPage } from '#/components/features/portal/portal-list-page'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { portalKeys } from '#/shared/queries/query-keys'
import { propertiesQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { ErrorState, LoadingState } from '#/components/layout/page-states'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'

const portalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.list(propertyId),
    queryFn: () => listPortals({ data: { propertyId } }),
    staleTime: 30_000,
  })

const portalGroupsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.groups(propertyId),
    queryFn: () => listPortalGroups({ data: { propertyId } }),
    staleTime: 30_000,
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/portals/')({
  beforeLoad: async ({ context, params }) => {
    await gateControlledRoute({
      data: {
        capability: 'portal.read',
        featureLabel: 'Portals',
        propertyId: params.propertyId,
      },
    })
    const { role } = context as AuthRouteContext
    if (!can(role, 'portal.read')) throw redirect({ to: '/properties' })
  },
  staleTime: 30_000,
  loader: async ({ params, context }) => {
    const [{ portals }, { groups }] = await Promise.all([
      context.queryClient.ensureQueryData(portalsQuery(params.propertyId)),
      context.queryClient.ensureQueryData(portalGroupsQuery(params.propertyId)),
    ])
    return {
      portals,
      groups,
      propertyId: params.propertyId,
    }
  },
  pendingComponent: PortalListLoading,
  errorComponent: PortalListError,
  component: PortalListRoute,
})

function PortalListLoading() {
  return (
    <PageShell>
      <LoadingState label="Loading portals and portal groups" />
    </PageShell>
  )
}

function PortalListError({ error }: { error: Error }) {
  return (
    <PageShell>
      <PageHeader title="Portals" description="Manage this property’s public pages." />
      <ErrorState message={error.message || 'Portals could not be loaded.'} />
    </PageShell>
  )
}

function PortalListRoute() {
  const { propertyId } = Route.useParams()
  const { data: portalsData } = useSuspenseQuery(portalsQuery(propertyId))
  const { data: portalGroupsData } = useSuspenseQuery(portalGroupsQuery(propertyId))
  const { data: propsData } = useSuspenseQuery(propertiesQuery)
  const { portals } = portalsData
  const { groups } = portalGroupsData
  const { properties } = propsData
  const property = properties?.find((p) => p.id === propertyId)
  const propertyName = property?.name ?? ''

  const deleteMutation = useActionMutation(deletePortal, {
    successMessage: 'Portal deleted',
    invalidateKeys: [portalKeys.list(propertyId), portalKeys.all],
  })
  const groupInvalidationKeys = [portalKeys.groups(propertyId)]
  const createGroupMutation = useActionMutation(createPortalGroup, {
    successMessage: 'Portal group created',
    invalidateKeys: groupInvalidationKeys,
  })
  const updateGroupMutation = useActionMutation(updatePortalGroup, {
    successMessage: 'Portal group updated',
    invalidateKeys: groupInvalidationKeys,
  })
  const deleteGroupMutation = useActionMutation(softDeletePortalGroup, {
    successMessage: 'Portal group archived',
    invalidateKeys: groupInvalidationKeys,
  })
  const addPortalToGroupMutation = useActionMutation(addPortalToGroup, {
    successMessage: 'Portal added to group',
    invalidateKeys: groupInvalidationKeys,
  })
  const removePortalFromGroupMutation = useActionMutation(removePortalFromGroup, {
    successMessage: 'Portal removed from group',
    invalidateKeys: groupInvalidationKeys,
  })

  // `groups` is `PortalGroupWithPortals` (a flat PortalGroup plus `portalIds`),
  // which already satisfies `PortalGroupView`, so it goes straight to the page.
  // The previous `item as unknown as {...}` normalization erased that type — the
  // very drift it claimed to guard against — and its `throw` ran during RENDER,
  // so one malformed group replaced the whole portals page via `errorComponent`.
  // `listPortalGroups` always returns `portalIds`; if that ever needs defending,
  // PortalGroupManagement's scoped `state="error"` + `onRetry` is the seam.
  return (
    <PortalListPage
      portals={portals}
      propertyId={propertyId}
      propertyName={propertyName}
      deleteMutation={deleteMutation}
      portalGroups={groups}
      createGroupMutation={createGroupMutation}
      updateGroupMutation={updateGroupMutation}
      deleteGroupMutation={deleteGroupMutation}
      addPortalToGroupMutation={addPortalToGroupMutation}
      removePortalFromGroupMutation={removePortalFromGroupMutation}
    />
  )
}
