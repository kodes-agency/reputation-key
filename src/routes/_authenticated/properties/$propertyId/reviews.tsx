// Property-scoped reviews = the inbox triage surface filtered by this property.
// Previously redirected to /inbox; now renders InboxPageV2 directly so the URL
// stays property-scoped, breadcrumbs work, and back-navigation returns to the
// property dashboard (not the picker).
import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { InboxPageV2, inboxSearchSchema } from '#/components/inbox/inbox-page-v2'
import { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'

const authRoute = getRouteApi('/_authenticated')
const propertyRoute = getRouteApi('/_authenticated/properties/$propertyId')

export const Route = createFileRoute('/_authenticated/properties/$propertyId/reviews')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'inbox.read')) throw redirect({ to: '/properties' })
  },
  validateSearch: (search) => inboxSearchSchema.parse(search),
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
      search={{ ...search, propertyId }}
      properties={parentData.properties}
      bulkUpdateFn={bulkUpdateInboxStatusFn}
      onNavigate={(opts) =>
        navigate({
          to: opts.to,
          search: opts.search({ ...search, propertyId }),
        })
      }
    />
  )
}
