// Inbox route v2 — three-panel email-style layout
import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { InboxPageV2, inboxSearchSchema } from '#/components/inbox/inbox-page-v2'
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
  const parentData = authRoute.useLoaderData() as {
    properties: ReadonlyArray<{ id: string; name: string }>
  }
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <InboxPageV2
      ctx={ctx}
      search={search}
      properties={parentData.properties}
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
