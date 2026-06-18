// Property-scoped reviews = the inbox triage surface filtered by this property.
// propertyId comes from the route param (path), NOT from search params.
import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { InboxPageV2, inboxSearchSchema } from '#/components/inbox/inbox-page-v2'
import { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'

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
  const parentData = authRoute.useLoaderData() as {
    properties: ReadonlyArray<{ id: string; name: string }>
  }
  const { propertyId } = propertyRoute.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <InboxPageV2
      ctx={ctx}
      search={search}
      activePropertyId={propertyId}
      properties={parentData.properties}
      bulkUpdateFn={bulkUpdateInboxStatusFn}
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
