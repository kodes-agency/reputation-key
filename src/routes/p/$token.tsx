import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { z } from 'zod/v4'
import {
  confirmGuestMediaFn,
  correctGuestResponseFn,
  issueGuestMediaFn,
  submitGuestResponseFn,
  withdrawGuestResponseFn,
} from '#/contexts/guest/server/public'
import { getPublicPortal, recordScanFn } from '#/contexts/guest/server/guest-scans'
import {
  GuestAnalyticsNotice,
  PortalUnavailable,
  PublicPortalContent,
} from '#/components/features/guest'
import type { PublicPortalLoaderData } from '#/contexts/guest/server/public'
import { guestKeys } from '#/shared/queries/query-keys'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'

// `source` is an untrusted campaign hint, never authorization. An unrecognised or
// missing value falls back to `direct` so a mangled QR query string still renders
// the portal instead of throwing on search validation.
const portalSearchSchema = z.object({
  source: z.enum(['qr', 'nfc', 'direct']).catch('direct'),
})

/**
 * Statuses `getPublicPortal` uses for the deliberate "there is no portal here"
 * posture: 404 `portal_not_found` (bad or rotated token, denied capability), 410
 * `portal_inactive` (unpublished portal, suspended property) and 403 `forbidden`.
 * All of them must stay externally indistinguishable to a guest, so they collapse
 * to the same `null`. Every other failure (500 from a DB blip, a network fault) is
 * rethrown: swallowing it cached a successful `null` for the whole 5-minute
 * staleTime, so a sub-second outage pinned "Portal Unavailable" for five minutes.
 */
const unavailablePostureStatus: Readonly<Record<number, true>> = {
  403: true,
  404: true,
  410: true,
}

/**
 * `ServerFunctionError` carries `.status`, but the class itself does not survive
 * seroval serialization across the server/client boundary — narrow structurally
 * rather than with `instanceof`.
 */
function isUnavailablePosture(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false
  const { status } = error
  return typeof status === 'number' && unavailablePostureStatus[status] === true
}

const publicPortalQuery = (token: string) =>
  queryOptions({
    queryKey: guestKeys.publicPortal({ token }),
    queryFn: async () => {
      try {
        return await getPublicPortal({ data: { token } })
      } catch (error) {
        if (isUnavailablePosture(error)) return null
        throw error
      }
    },
    staleTime: 5 * 60 * 1000,
  })

/**
 * C1: the server resolves the `portal.guest_response` / `portal.guest_media`
 * capability decisions. The form view has no separate 'unavailable' branch — a
 * tenant-disabled response surface and a transient failure read the same to a
 * guest, so both land on its 'error' copy.
 */
const formAvailability: Readonly<
  Record<
    'available' | 'permission_denied' | 'unavailable',
    'available' | 'permission_denied' | 'error'
  >
> = {
  available: 'available',
  permission_denied: 'permission_denied',
  unavailable: 'error',
}

export const Route = createFileRoute('/p/$token')({
  validateSearch: portalSearchSchema,
  staleTime: 5 * 60 * 1000,
  loader: async ({ context, params }): Promise<PublicPortalLoaderData | null> => {
    return context.queryClient.ensureQueryData(publicPortalQuery(params.token))
  },
  head: ({ loaderData }) => {
    // The opaque token is the entire access control for a guest portal, so the page
    // must never be indexable — regardless of publication state, and in addition to
    // the `Disallow: /p/` in robots.txt (the meta tag covers crawlers that fetch the
    // URL anyway). Deliberately no canonical URL: canonicalising a secret-token URL
    // would republish the token to every consumer of the page.
    const robots = { name: 'robots', content: 'noindex, nofollow' }
    if (!loaderData) return { meta: [{ title: 'Portal unavailable' }, robots] }
    const { portal } = loaderData
    const description = portal.description ?? ''
    return {
      meta: [
        { title: `${portal.name} — ${portal.organizationName}` },
        robots,
        { name: 'description', content: description },
        { property: 'og:type', content: 'website' },
        { property: 'og:title', content: portal.name },
        { property: 'og:description', content: description },
        // QR portals are shared into WhatsApp/iMessage/Slack far more often than
        // they are browsed, so the hero image is the preview that matters.
        ...(portal.heroImageUrl
          ? [
              { property: 'og:image', content: portal.heroImageUrl },
              { name: 'twitter:card', content: 'summary_large_image' },
            ]
          : [{ name: 'twitter:card', content: 'summary' }]),
      ],
    }
  },
  notFoundComponent: PortalUnavailable,
  errorComponent: PortalUnavailable,
  component: PublicPortalPage,
})

/**
 * Gate only — it owns no hooks beyond the query. Every other hook lives in
 * `PublicPortalView`, so the hook count cannot change when `data` flips
 * null↔loaded on a revalidation. The previous inline `if (!data) return …` guard
 * sat above five `useAction`/`useServerFn` calls and threw "Rendered more hooks
 * than during the previous render" on that transition, dropping the whole public
 * page into `errorComponent`.
 */
function PublicPortalPage() {
  const { token } = Route.useParams()
  const { data } = useSuspenseQuery(publicPortalQuery(token))
  if (!data) return <PortalUnavailable />
  return <PublicPortalView token={token} data={data} />
}

function PublicPortalView({
  token,
  data,
}: Readonly<{ token: string; data: PublicPortalLoaderData }>) {
  const { source } = Route.useSearch()
  const submitResponse = useAction(useServerFn(submitGuestResponseFn))
  const correctResponse = useAction(useServerFn(correctGuestResponseFn))
  const withdrawResponse = useAction(useServerFn(withdrawGuestResponseFn))
  const issueMedia = useAction(useServerFn(issueGuestMediaFn))
  const confirmMedia = useAction(useServerFn(confirmGuestMediaFn))
  const recordScan = useServerFn(recordScanFn)
  const { csrfNonce } = data.guestSession

  // Visit analytics is a core portal function. The disclosure invokes this once
  // per portal/browser session; the server owns authoritative session dedupe and
  // layered abuse controls.
  const recordPortalVisit = useCallback(async () => {
    const result = await recordScan({
      data: { token, csrfNonce, source },
    })
    if (!result.success) throw new Error('Portal visit was not recorded')
  }, [recordScan, token, csrfNonce, source])

  return (
    <>
      <GuestAnalyticsNotice scopeKey={data.portal.id} onPortalVisit={recordPortalVisit} />
      <PublicPortalContent
        token={token}
        portal={data.portal}
        categories={data.categories}
        links={data.links}
        responseForm={{
          csrfNonce,
          initialResponse: data.response,
          availability: formAvailability[data.responseForm.availability],
          mediaEnabled: data.responseForm.mediaEnabled,
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
