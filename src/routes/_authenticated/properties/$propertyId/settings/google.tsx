import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { PropertyGoogleSection } from '#/components/features/property/settings/property-google-section'
import { propertyQuery } from '#/routes/-queries/route-queries'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/settings/google',
)({
  component: PropertyGoogleSettings,
})

function PropertyGoogleSettings() {
  const { propertyId } = Route.useParams()
  const { data } = useSuspenseQuery(propertyQuery(propertyId))
  return <PropertyGoogleSection property={data.property} />
}
