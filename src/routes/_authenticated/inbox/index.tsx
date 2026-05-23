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

function toInboxPrev(prev: Record<string, unknown>): InboxSearchParams {
  const status = prev.status as string | undefined
  const validStatuses = new Set(['new', 'read', 'addressed', 'escalated', 'archived'])
  return {
    itemId: prev.itemId as string | undefined,
    propertyId: prev.propertyId as string | undefined,
    status:
      status && validStatuses.has(status)
        ? (status as InboxSearchParams['status'])
        : undefined,
    sourceType: prev.sourceType as InboxSearchParams['sourceType'],
    platform: prev.platform as string | undefined,
    ratingMin: prev.ratingMin as number | undefined,
    ratingMax: prev.ratingMax as number | undefined,
  }
}

function InboxRoute() {
  const ctx = authRoute.useRouteContext() as AuthRouteContext
  const search = Route.useSearch()
  const navigate = useNavigate()

  return (
    <InboxPage
      ctx={ctx}
      search={search}
      onNavigate={(opts) =>
        navigate({
          to: opts.to,
          search: (prev) => opts.search(toInboxPrev(prev)),
        })
      }
    />
  )
}
