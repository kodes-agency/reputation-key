// The Property look: the photo, colours, name and logo, and default languages
// shared by every portal of a Property (round-4 admin board 9). The route owns
// the reads and the two autosaved writes; the page draws them.
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import { portalKeys } from '#/shared/queries/query-keys'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { getPortalPreview } from '#/contexts/portal/server/portal-preview'
import {
  savePropertyDefaultGuestLocales,
  savePropertyLook,
} from '#/contexts/portal/server/property-look'
import { PropertyLookPage } from '#/components/features/portal/property-look/property-look-page'
import {
  PortalListError,
  PortalListLoading,
} from '#/components/features/portal/portal-route-fallbacks'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { propertyPortalExperienceQuery } from '../-settings-queries'
import { portalOverviewQuery } from './-portal-overview-data'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/look',
)({
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
    await Promise.all([
      context.queryClient.ensureQueryData(portalOverviewQuery(params.propertyId)),
      context.queryClient.ensureQueryData(
        propertyPortalExperienceQuery(params.propertyId),
      ),
      context.queryClient.ensureQueryData(propertyQuery(params.propertyId)),
    ])
  },
  pendingComponent: PortalListLoading,
  errorComponent: PortalListError,
  component: PropertyLookRoute,
})

function PropertyLookRoute() {
  const { propertyId } = Route.useParams()
  const queryClient = useQueryClient()
  const { has } = useCapabilities()
  const { data: overview } = useSuspenseQuery(portalOverviewQuery(propertyId))
  const { data: experience } = useSuspenseQuery(propertyPortalExperienceQuery(propertyId))
  const { data: property } = useSuspenseQuery(propertyQuery(propertyId))

  // A look edit changes what every portal's draft preview draws and what each
  // live portal has waiting to publish, so the previews and the overview follow.
  const refreshPortals = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: portalKeys.propertyExperience(propertyId),
      }),
      queryClient.invalidateQueries({ queryKey: portalKeys.overview(propertyId) }),
      ...overview.portals.map((row) =>
        queryClient.invalidateQueries({
          queryKey: portalKeys.publicationHistory(row.portalId),
        }),
      ),
    ])
  }
  const saveLook = useActionMutation(savePropertyLook, { onSuccess: refreshPortals })
  const saveLocales = useActionMutation(savePropertyDefaultGuestLocales, {
    // New portals read them in the New portal dialog.
    invalidateKeys: [portalKeys.creationOptions(propertyId)],
  })

  return (
    <PropertyLookPage
      propertyId={propertyId}
      propertyName={property.property.name}
      profile={experience.profile}
      canEdit={experience.canManagePropertyBrand && has('portal.write')}
      rows={overview.portals}
      getPortalPreview={getPortalPreview}
      saveLook={saveLook}
      saveLocales={saveLocales}
    />
  )
}
