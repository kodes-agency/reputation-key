// The Staff page loads only accounts. Attribution tables remain for reporting.
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { PeoplePage } from '#/components/features/property/people/people-page'
import { peopleSearchSchema } from '#/components/features/property/people/people-search-schema'
import { gateControlledRoute } from '#/shared/shell-context/remembered-route-gate'
import { propertyQuery } from '#/routes/-queries/route-queries'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/people')({
  staticData: {
    page: { title: 'Staff', tier: 'dashboard', under: 'property', loading: 'list' },
  },
  beforeLoad: async ({ context, params }) => {
    await gateControlledRoute({
      context,
      data: {
        capability: 'staff.accounts',
        featureLabel: 'Staff',
        propertyId: params.propertyId,
      },
    })
    const { role } = context as AuthRouteContext
    if (!can(role, 'staff.read')) throw roleUnavailable('Staff', 'properties')
  },
  validateSearch: (search) => peopleSearchSchema.parse(search),
  component: PeopleRoute,
})
function PeopleRoute() {
  const { propertyId } = Route.useParams()
  const { data } = useSuspenseQuery(propertyQuery(propertyId))
  return <PeoplePage propertyId={propertyId} propertyName={data.property.name} />
}
