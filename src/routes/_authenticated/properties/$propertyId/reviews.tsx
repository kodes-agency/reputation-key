// Property-scoped reviews = the inbox triage surface filtered by this property.
// propertyId comes from the route param (path), NOT from search params.
import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { InboxPageV2 } from '#/components/inbox/inbox-page-v2'
import {
  inboxSearchObjectSchema,
  inboxSearchSchema,
  normalizeInboxRatingPreset,
} from '#/components/inbox/inbox-search-schema'
import { inboxFns } from '#/routes/_authenticated/-inbox-fns'
import { membersQuery, propertiesQuery } from '#/routes/-queries/route-queries'
import {
  canListInboxAssignmentCandidates,
  toInboxAssignmentOptions,
} from '#/routes/_authenticated/inbox/-assignment-candidates'

const authRoute = getRouteApi('/_authenticated')
const propertyRoute = getRouteApi('/_authenticated/properties/$propertyId')

// Reviews route excludes propertyId from search — it's in the URL path.
const reviewsSearchSchema = inboxSearchObjectSchema
  .omit({ propertyId: true })
  .transform((search) => inboxSearchSchema.parse(normalizeInboxRatingPreset(search)))

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
  const mayListAssignmentCandidates = canListInboxAssignmentCandidates(ctx.role)
  const { data: membersData } = useQuery({
    ...membersQuery,
    enabled: mayListAssignmentCandidates,
  })
  const { data: propertiesData } = useQuery(propertiesQuery)
  const { propertyId } = propertyRoute.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <InboxPageV2
      ctx={ctx}
      search={search}
      activePropertyId={propertyId}
      scopeLabel={
        propertiesData?.properties.find((property) => property.id === propertyId)?.name ??
        'Property'
      }
      assignmentOptions={toInboxAssignmentOptions(membersData?.members ?? [])}
      inboxFns={inboxFns}
      onNavigate={(opts) =>
        navigate({
          to: opts.to,
          search: opts.search(search),
          replace: opts.replace,
        })
      }
    />
  )
}
