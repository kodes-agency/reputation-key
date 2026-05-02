import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { getPublicPortal } from '#/contexts/guest/server/public'
import { PortalUnavailable } from '#/components/guest/portal-unavailable'
import { PublicPortalContent } from '#/components/guest/PublicPortalContent'
import { CookieConsentBanner } from '#/components/guest/cookie-consent-banner'
import type { PublicPortalLoaderData } from '#/contexts/guest/application/dto/public-portal.dto'

const VALID_SOURCES: ReadonlySet<string> = new Set(['qr', 'nfc', 'direct'])
type ScanSource = 'qr' | 'nfc' | 'direct'

function parseSource(raw: string | null): ScanSource {
  return raw && VALID_SOURCES.has(raw) ? (raw as ScanSource) : 'direct'
}

export const Route = createFileRoute('/p/$propertySlug/$portalSlug')({
  validateSearch: (search: Record<string, string>) => ({
    source: search.source,
  }),
  loader: async ({ params }): Promise<PublicPortalLoaderData | null> => {
    try {
      const portalData = await getPublicPortal({
        data: {
          orgSlug: params.propertySlug,
          portalSlug: params.portalSlug,
        },
      })
      return portalData
    } catch {
      // Return null for portal_not_found, portal_inactive, and other errors
      return null
    }
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
  component: PublicPortalPage,
})

function PublicPortalPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const source = parseSource(search.source ?? null)

  // Ensure guest session cookie exists for rating/feedback
  useEffect(() => {
    if (!document.cookie.includes('guest_session')) {
      const sessionId = crypto.randomUUID()
      document.cookie = `guest_session=${sessionId}; path=/p/; max-age=86400; SameSite=Lax`
    }
  }, [])

  if (!data) {
    return <PortalUnavailable />
  }

  const { portal, categories, links } = data

  return (
    <>
      <CookieConsentBanner />
      <PublicPortalContent
        portal={portal}
        categories={categories}
        links={links}
        source={source}
      />
    </>
  )
}
