import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { z } from 'zod/v4'
import {
  correctGuestResponseFn,
  selectSecondaryLinkFn,
  selectGoogleReviewFn,
  startNewGuestResponseFn,
  submitPrivateFeedbackFn,
  submitGuestResponseFn,
  withdrawPrivateFeedbackFn,
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

// The public UUID is only a channel marker. The server binds it to the stable
// address and exact live publication before it can qualify an observation.
const portalSearchSchema = z.object({
  accessArtifact: z.uuid().optional().catch(undefined),
  locale: z.enum(['en', 'bg']).optional().catch(undefined),
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

const publicPortalQuery = (token: string, locale?: 'en' | 'bg') =>
  queryOptions({
    queryKey: guestKeys.publicPortal({ token, locale: locale ?? 'auto' }),
    queryFn: async () => {
      try {
        return await getPublicPortal({ data: { token, locale } })
      } catch (error) {
        if (isUnavailablePosture(error)) return null
        throw error
      }
    },
    staleTime: 5 * 60 * 1000,
  })

/**
 * C1: the server resolves the `portal.guest_response` capability decision. The
 * form view has no separate 'unavailable' branch — a
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
  loaderDeps: ({ search }) => ({ locale: search.locale }),
  staleTime: 5 * 60 * 1000,
  loader: async ({ context, params, deps }): Promise<PublicPortalLoaderData | null> => {
    return context.queryClient.ensureQueryData(
      publicPortalQuery(params.token, deps.locale),
    )
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
  const { locale } = Route.useSearch()
  const { data } = useSuspenseQuery(publicPortalQuery(token, locale))
  if (!data) return <PortalUnavailable />
  // The file-route match is reused when only the token parameter changes.
  // Remount the complete guest journey so a prior Portal's response receipt,
  // CSRF nonce, rating draft, and analytics state cannot cross that boundary.
  return <PublicPortalView key={token} token={token} data={data} />
}

function PublicPortalView({
  token,
  data,
}: Readonly<{ token: string; data: PublicPortalLoaderData }>) {
  const { accessArtifact, locale } = Route.useSearch()
  const queryClient = useQueryClient()
  const submitResponse = useAction(useServerFn(submitGuestResponseFn))
  const correctResponse = useAction(useServerFn(correctGuestResponseFn))
  const startNewResponseAction = useAction(useServerFn(startNewGuestResponseFn))
  const withdrawResponse = useAction(useServerFn(withdrawGuestResponseFn))
  const withdrawPrivateFeedback = useAction(useServerFn(withdrawPrivateFeedbackFn))
  const submitPrivateFeedback = useAction(useServerFn(submitPrivateFeedbackFn))
  const selectGoogleReview = useAction(useServerFn(selectGoogleReviewFn))
  const selectSecondaryLink = useAction(useServerFn(selectSecondaryLinkFn))
  const recordScan = useServerFn(recordScanFn)
  const { csrfNonce } = data.guestSession

  const startNewResponse = useCallback(
    async (input: Parameters<typeof startNewResponseAction>[0]) => {
      const nextSession = await startNewResponseAction(input)
      queryClient.setQueryData<PublicPortalLoaderData | null>(
        guestKeys.publicPortal({ token, locale: locale ?? 'auto' }),
        (cached) =>
          cached
            ? {
                ...cached,
                guestSession: { csrfNonce: nextSession.csrfNonce },
                response: null,
              }
            : cached,
      )
      return nextSession
    },
    [queryClient, startNewResponseAction, token, locale],
  )

  // Visit analytics is a core portal function. The disclosure invokes this once
  // per portal/browser session; the server owns authoritative session dedupe and
  // layered abuse controls.
  const recordPortalVisit = useCallback(async () => {
    const result = await recordScan({
      data: { token, csrfNonce, accessArtifactId: accessArtifact ?? null },
    })
    if (result.success) return 'recorded' as const
    return result.retryable ? ('retryable' as const) : ('settled' as const)
  }, [recordScan, token, csrfNonce, accessArtifact])

  return (
    <>
      <GuestAnalyticsNotice
        scopeKey={token}
        sessionKey={csrfNonce}
        locale={data.localization.selectedLocale}
        languagePackVersion={data.localization.languagePackVersion}
        onPortalVisit={recordPortalVisit}
      />
      <PublicPortalContent
        token={token}
        accessArtifactId={accessArtifact}
        portal={data.portal}
        categories={data.categories}
        links={data.links}
        reviewGateway={data.reviewGateway}
        localization={data.localization}
        selectSecondaryLink={selectSecondaryLink}
        responseForm={{
          csrfNonce,
          initialResponse: data.response,
          availability: formAvailability[data.responseForm.availability],
          submitResponse,
          correctResponse,
          startNewResponse,
          submitPrivateFeedback,
          selectGoogleReview,
          withdrawResponse,
          withdrawPrivateFeedback,
        }}
      />
    </>
  )
}
