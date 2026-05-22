// Inbox route — thin wrapper around InboxPage component
import { createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { InboxPage, inboxSearchSchema } from '#/components/inbox/inbox-page'
import type { InboxSearchParams } from '#/components/inbox/inbox-page'

const authRoute = getRouteApi('/_authenticated')

export const Route = createFileRoute('/_authenticated/inbox/')({
  validateSearch: (search) => inboxSearchSchema.parse(search),
  staleTime: 30_000,
  component: InboxRoute,
})

function InboxRoute() {
  const ctx = authRoute.useRouteContext() as AuthRouteContext
  const search = Route.useSearch()
  const navigate = useNavigate()

  return (
    <InboxPage
      ctx={ctx}
      search={search}
      onNavigate={(opts) => navigate({ to: opts.to, search: opts.search as (prev: InboxSearchParams) => InboxSearchParams })}
    />
  )
}
