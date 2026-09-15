// Inbox route v2 — three-panel email-style layout
import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { InboxPageV2 } from '#/components/inbox/inbox-page-v2'
import {
  inboxSearchSchema,
  type InboxSearchParams,
} from '#/components/inbox/inbox-search-schema'
import { inboxFns } from '#/routes/_authenticated/-inbox-fns'
import { membersQuery } from '#/routes/-queries/route-queries'
import {
  canListInboxAssignmentCandidates,
  toInboxAssignmentOptions,
} from './-assignment-candidates'
import { useInboxRouteScope } from './-property-scope'

const authRoute = getRouteApi('/_authenticated')

export const Route = createFileRoute('/_authenticated/inbox/')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    // Inbox triage is a manager surface (inbox.manage).
    // Staff have inbox.read for counts, not the triage surface.
    if (!can(role, 'inbox.manage')) throw redirect({ to: '/properties' })
  },
  validateSearch: (search) => inboxSearchSchema.parse(search),
  staleTime: 30_000,
  component: InboxRoute,
})

function InboxRoute() {
  const ctx = authRoute.useRouteContext() as AuthRouteContext
  const mayListAssignmentCandidates = canListInboxAssignmentCandidates(ctx.role)
  const { data: membersData } = useQuery({
    ...membersQuery,
    enabled: mayListAssignmentCandidates,
  })
  const search = Route.useSearch() as InboxSearchParams
  const navigate = Route.useNavigate()
  // This route is the organization-wide Inbox, so its viewers have one.
  const { propertyScope, scopeLabel } = useInboxRouteScope(
    search.propertyId ?? null,
    true,
  )

  return (
    <InboxPageV2
      ctx={ctx}
      search={search}
      assignmentOptions={toInboxAssignmentOptions(membersData?.members ?? [])}
      scopeLabel={scopeLabel}
      propertyScope={propertyScope}
      inboxFns={inboxFns}
      recordInboxVisit
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
