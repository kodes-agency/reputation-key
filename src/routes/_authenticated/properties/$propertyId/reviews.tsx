// Property-scoped reviews = the inbox triage surface filtered by this property.
// propertyId comes from the route param (path), NOT from search params.
import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { InboxPageV2, inboxSearchSchema } from '#/components/inbox/inbox-page-v2'
import { inboxFns } from '#/routes/_authenticated/-inbox-fns'
import { propertiesQuery } from '#/shared/queries/route-queries'

const authRoute = getRouteApi('/_authenticated')
const propertyRoute = getRouteApi('/_authenticated/properties/$propertyId')

// Reviews route excludes propertyId from search — it's in the URL path.
const reviewsSearchSchema = inboxSearchSchema.omit({ propertyId: true })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/reviews')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'inbox.read')) throw redirect({ to: '/properties' })
  },
  validateSearch: (search) => reviewsSearchSchema.parse(search),
  staleTime: 30_000,
  component: PropertyReviewsRoute,
})

function PropertyReviewsRoute() {
  const ctx = authRoute.useRouteContext() as AuthRouteContext
  const { data: propsData } = useSuspenseQuery(propertiesQuery)
  const { propertyId } = propertyRoute.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <InboxPageV2
      ctx={ctx}
      search={search}
      activePropertyId={propertyId}
      properties={propsData.properties}
      inboxFns={inboxFns}
      onNavigate={(opts) =>
        navigate({
          to: opts.to,
          search: opts.search(search),
        })
      }
      onPropertyChange={(id) => {
        if (id) {
          navigate({ to: '/properties/$propertyId/reviews', params: { propertyId: id } })
        } else {
          navigate({ to: '/inbox' })
        }
      }}
    />
  )
}
