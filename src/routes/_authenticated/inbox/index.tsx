// Inbox route — thin wrapper around InboxPage component
import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { InboxPage, inboxSearchSchema } from '#/components/inbox/inbox-page'
import { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'

const authRoute = getRouteApi('/_authenticated')

export const Route = createFileRoute('/_authenticated/inbox/')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'inbox.read')) throw redirect({ to: '/properties' })
  },
  validateSearch: (search) => inboxSearchSchema.parse(search),
  staleTime: 30_000,
  component: InboxRoute,
})

function InboxRoute() {
  const ctx = authRoute.useRouteContext() as AuthRouteContext
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <InboxPage
      ctx={ctx}
      search={search}
      bulkUpdateFn={bulkUpdateInboxStatusFn}
      onNavigate={(opts) =>
        navigate({
          to: opts.to,
          search: opts.search(search),
        })
      }
    />
  )
}
