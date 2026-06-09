import { createFileRoute, notFound } from '@tanstack/react-router'
import { useEffect } from 'react'
import {
  getPublicPortal,
  submitFeedbackFn,
  submitRatingFn,
  recordScanFn,
} from '#/contexts/guest/server/public'
import { PortalUnavailable } from '#/components/features/guest'
import { PublicPortalContent } from '#/components/features/guest'
import { CookieConsentBanner } from '#/components/features/guest'
import type { PublicPortalLoaderData } from '#/contexts/guest/server/public'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'

const VALID_SOURCES: ReadonlySet<string> = new Set(['qr', 'nfc', 'direct'])
type ScanSource = 'qr' | 'nfc' | 'direct'

function parseSource(raw: string | null): ScanSource {
  return raw && VALID_SOURCES.has(raw) ? (raw as ScanSource) : 'direct'
}

export const Route = createFileRoute('/p/$propertySlug/$portalSlug')({
  validateSearch: (search: Record<string, string>) => ({
    source: search.source,
  }),
  staleTime: 5 * 60 * 1000,
  loader: async ({ params }): Promise<PublicPortalLoaderData> => {
    const portalData = await getPublicPortal({
      data: {
        propertySlug: params.propertySlug,
        portalSlug: params.portalSlug,
      },
    })

    // getPublicPortal throws on server errors (500, network, etc.).
    // A null return means the portal was not found — convert to notFound()
    // so TanStack Router renders the notFoundComponent.
    if (!portalData) {
      throw notFound()
    }

    return portalData
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: 'Portal Not Found' }] }
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
  component: PublicPortalPage,
})

function PublicPortalPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const source = parseSource(search.source ?? null)

  const submitFeedback = useAction(useServerFn(submitFeedbackFn))
  const submitRating = useAction(useServerFn(submitRatingFn))
  const recordScan = useAction(useServerFn(recordScanFn))

  // Ensure guest session cookie exists and record scan on first load
  useEffect(() => {
    if (!document.cookie.includes('guest_session')) {
      const sessionId = crypto.randomUUID()
      document.cookie = `guest_session=${sessionId}; path=/p/; max-age=86400; SameSite=Lax`
    }

    // Record the scan
    recordScan({
      data: {
        portalId: data.portal.id,
        source,
      },
    })
    // F130: data.portal.id and source are derived from loader/search params which are
    // stable for the lifetime of this component (route params don't change without remount).
    // Adding deps would cause re-scans on any re-render, which is worse.
  }, [])

  const { portal, categories, links } = data

  return (
    <>
      <CookieConsentBanner />
      <PublicPortalContent
        portal={portal}
        categories={categories}
        links={links}
        source={source}
        submitFeedback={submitFeedback}
        submitRating={submitRating}
      />
    </>
  )
}
