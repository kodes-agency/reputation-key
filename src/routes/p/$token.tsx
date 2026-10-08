import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { z } from 'zod/v4'
import { guestLocaleSchema } from '#/shared/guest-locale-schemas'
import type { GuestLocale } from '#/shared/domain/guest-locale'
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
  ImmersivePublicPortal,
  PublicPortalContent,
  type GuestPortalCopyV2,
} from '#/components/features/guest'
import { guestPageHead } from '#/components/features/guest/guest-page-head'
import { PortalUnavailable } from '#/components/features/guest/portal-unavailable'
import type { PublicPortalLoaderData } from '#/contexts/guest/server/public'
import { guestKeys } from '#/shared/queries/query-keys'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'

// The public UUID is only a channel marker. The server binds it to the stable
// address and exact live publication before it can qualify an observation.
const portalSearchSchema = z.object({
  accessArtifact: z.uuid().optional().catch(undefined),
  locale: guestLocaleSchema.optional().catch(undefined),
})

/**
 * Statuses `getPublicPortal` uses for the deliberate "there is no portal here"
 * posture: 404 `portal_not_found` (bad or rotated token, denied capability), 410
 * `portal_inactive` (unpublished portal, suspended property) and 403 `forbidden`.
 * All of them must stay externally indistinguishable to a guest, so they collapse
 * to the same `null`. Every other failure (500 from a DB blip, a network fault) is
 * rethrown: swallowing it cached a successful `null` for the whole 5-minute
 * staleTime, so a sub-second outage pinned the unavailable page for five minutes.
 */
const unavailablePostureStatus: Readonly<Record<number, true>> = {
  403: true,
  404: true,
  410: true,
}

/**
 * `ServerFunctionError` carries `.status` across the server/client boundary
 * (`serverFunctionErrorAdapter`); narrowing structurally keeps this route
 * independent of the class.
 */
function isUnavailablePosture(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false
  const { status } = error
  return typeof status === 'number' && unavailablePostureStatus[status] === true
}

/**
 * What the page renders from: the server's loader data and, for a schema
 * version 3 portal, the one copy pack of the page's language. The pack is loaded
 * with the data (one language, one dynamic import), so the server render and the
 * hydration read the same copy and no client request fetches it afterwards. A
 * pack that cannot be loaded fails the whole read, never to another language.
 */
export type GuestPageData = PublicPortalLoaderData &
  Readonly<{ pack: GuestPortalCopyV2 | null }>

const publicPortalQuery = (token: string, locale?: GuestLocale) =>
  queryOptions({
    queryKey: guestKeys.publicPortal({ token, locale: locale ?? 'auto' }),
    queryFn: async (): Promise<GuestPageData | null> => {
      try {
        const data = await getPublicPortal({ data: { token, locale } })
        // A dynamic import of the loader's own module, not the guest barrel: the
        // loader belongs to the route's critical chunk, and a static edge to the
        // barrel would put the whole guest page in every page's first paint.
        const pack = data.immersive
          ? await (
              await import('#/components/features/guest/public-portal/language-packs/load-guest-copy-v2')
            ).loadGuestPortalCopyV2(
              data.localization.selectedLocale,
              data.localization.languagePackVersion,
            )
          : null
        return { ...data, pack }
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
  loader: async ({ context, params, deps }): Promise<GuestPageData | null> => {
    return context.queryClient.ensureQueryData(
      publicPortalQuery(params.token, deps.locale),
    )
  },
  head: ({ loaderData }) => guestPageHead(loaderData?.portal ?? null),
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

// fallow-ignore-next-line complexity
function PublicPortalView({
  token,
  data,
}: Readonly<{ token: string; data: GuestPageData }>) {
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
      queryClient.setQueryData<GuestPageData | null>(
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

  if (data.immersive) {
    // Schema version 3: the Immersive Hub. It records the visit from its own
    // footer, where the notice sits inline, so it mounts no overlay.
    if (!data.pack) return <PortalUnavailable />
    return (
      <ImmersivePublicPortal
        token={token}
        accessArtifactId={accessArtifact}
        pack={data.pack}
        immersive={data.immersive}
        selectedLocale={data.localization.selectedLocale}
        availableLocales={data.localization.availableLocales}
        googleReview={data.reviewGateway.googleReview}
        csrfNonce={csrfNonce}
        initialResponse={data.response}
        availability={formAvailability[data.responseForm.availability]}
        servedAt={data.servedAt}
        actions={{
          submitResponse,
          correctResponse,
          startNewResponse,
          submitPrivateFeedback,
          selectGoogleReview,
          withdrawResponse,
          withdrawPrivateFeedback,
          selectSecondaryLink,
        }}
        onPortalVisit={recordPortalVisit}
      />
    )
  }

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
