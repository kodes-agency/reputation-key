// Inbox route v2 — three-panel email-style layout
import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { InboxPageV2, inboxSearchSchema } from '#/components/inbox/inbox-page-v2'
import { inboxFns } from '#/routes/_authenticated/-inbox-fns'
import { membersQuery, propertiesQuery } from '#/routes/-queries/route-queries'
import {
  canListInboxAssignmentCandidates,
  toInboxAssignmentOptions,
} from './-assignment-candidates'

const authRoute = getRouteApi('/_authenticated')

export const Route = createFileRoute('/_authenticated/inbox/')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    // Inbox triage is a manager surface (inbox.manage).
    // Staff have inbox.read for counts, not the triage surface.
    if (!can(role, 'inbox.manage')) throw redirect({ to: '/home' })
  },
  validateSearch: (search) => inboxSearchSchema.parse(search),
  staleTime: 30_000,
  component: InboxRoute,
})

function InboxRoute() {
  const ctx = authRoute.useRouteContext() as AuthRouteContext
  const { data: propsData } = useSuspenseQuery(propertiesQuery)
  const mayListAssignmentCandidates = canListInboxAssignmentCandidates(ctx.role)
  const { data: membersData } = useQuery({
    ...membersQuery,
    enabled: mayListAssignmentCandidates,
  })
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <InboxPageV2
      ctx={ctx}
      search={search}
      properties={propsData.properties}
      assignmentOptions={toInboxAssignmentOptions(membersData?.members ?? [])}
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
