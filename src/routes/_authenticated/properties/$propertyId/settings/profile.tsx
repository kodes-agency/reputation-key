import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { PropertyProfileCard } from '#/components/features/property/settings/property-profile-card'
import { PropertyPublicDisplayNameCard } from '#/components/features/property/property-public-display-name-card'
import { updateProperty } from '#/contexts/property/server/properties'
import { savePropertyPortalBrandProfile } from '#/contexts/portal/server/portals'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { can } from '#/shared/domain/permissions'
import { inboxKeys, portalKeys, propertyKeys } from '#/shared/queries/query-keys'
import { propertyPortalExperienceQuery } from '../-settings-queries'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/settings/profile',
)({
  loader: async ({ params: { propertyId }, context }) => {
    const { role } = context as AuthRouteContext
    if (can(role, 'portal.read')) {
      await context.queryClient.ensureQueryData(propertyPortalExperienceQuery(propertyId))
    }
  },
  component: PropertyProfileSettings,
})

function PropertyProfileSettings() {
  const { propertyId } = Route.useParams()
  const { role } = Route.useRouteContext() as AuthRouteContext
  const { data } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: portalExperience } = useQuery({
    ...propertyPortalExperienceQuery(propertyId),
    enabled: can(role, 'portal.read'),
  })
  const saveProfile = useActionMutation(updateProperty, {
    successMessage: 'Property profile saved',
    invalidateKeys: [
      propertyKeys.detail(propertyId),
      propertyKeys.list(),
      inboxKeys.details(),
    ],
  })
  const savePublicDisplayName = useActionMutation(savePropertyPortalBrandProfile, {
    successMessage: 'Public display name saved',
    invalidateKeys: [portalKeys.propertyExperience(propertyId)],
  })

  return (
    <>
      <PropertyProfileCard
        key={`${propertyId}:${data.property.profileVersion}:${data.property.updatedAt}`}
        property={data.property}
        canEdit={can(role, 'property.update')}
        updateProperty={saveProfile}
      />
      {portalExperience ? (
        <PropertyPublicDisplayNameCard
          key={`${propertyId}:display-name`}
          propertyId={propertyId}
          profile={portalExperience.profile}
          action={savePublicDisplayName}
        />
      ) : null}
    </>
  )
}
