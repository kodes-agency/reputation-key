import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import {
  confirmGuestMediaFn,
  correctGuestResponseFn,
  issueGuestMediaFn,
  submitGuestResponseFn,
  withdrawGuestResponseFn,
} from '#/contexts/guest/server/public'
import { getPublicPortal } from '#/contexts/guest/server/guest-scans'
import {
  CookieConsentBanner,
  PortalUnavailable,
  PublicPortalContent,
} from '#/components/features/guest'
import type { PublicPortalLoaderData } from '#/contexts/guest/server/public'
import { guestKeys } from '#/shared/queries/query-keys'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'

const publicPortalQuery = (token: string) =>
  queryOptions({
    queryKey: guestKeys.publicPortal({ token }),
    queryFn: async () => {
      try {
        return await getPublicPortal({ data: { token } })
      } catch {
        return null
      }
    },
    staleTime: 5 * 60 * 1000,
  })

export const Route = createFileRoute('/p/$token')({
  validateSearch: (search: Record<string, string>) => ({ source: search.source }),
  staleTime: 5 * 60 * 1000,
  loader: async ({ context, params }): Promise<PublicPortalLoaderData | null> => {
    return context.queryClient.ensureQueryData(publicPortalQuery(params.token))
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: 'Portal unavailable' }] }
    return {
      meta: [
        { title: `${loaderData.portal.name} — ${loaderData.portal.organizationName}` },
        { name: 'description', content: loaderData.portal.description ?? '' },
        { property: 'og:title', content: loaderData.portal.name },
        { property: 'og:description', content: loaderData.portal.description ?? '' },
      ],
    }
  },
  notFoundComponent: PortalUnavailable,
  errorComponent: PortalUnavailable,
  component: PublicPortalPage,
})

function PublicPortalPage() {
  const { token } = Route.useParams()
  const { data } = useSuspenseQuery(publicPortalQuery(token))
  if (!data) return <PortalUnavailable />
  const submitResponse = useAction(useServerFn(submitGuestResponseFn))
  const correctResponse = useAction(useServerFn(correctGuestResponseFn))
  const withdrawResponse = useAction(useServerFn(withdrawGuestResponseFn))
  const issueMedia = useAction(useServerFn(issueGuestMediaFn))
  const confirmMedia = useAction(useServerFn(confirmGuestMediaFn))

  return (
    <>
      <CookieConsentBanner />
      <PublicPortalContent
        token={token}
        portal={data.portal}
        categories={data.categories}
        links={data.links}
        responseForm={{
          csrfNonce: data.guestSession.csrfNonce,
          initialResponse: data.response,
          submitResponse,
          correctResponse,
          withdrawResponse,
          issueMedia,
          confirmMedia,
        }}
      />
    </>
  )
}
