import { createFileRoute } from '@tanstack/react-router'
import { getPublicPortal } from '#/contexts/guest/server/public'
import { PortalNotFound } from '#/components/guest/portal-not-found'
import { StarRating } from '#/components/guest/star-rating'
import { FeedbackForm } from '#/components/guest/feedback-form'
import { CookieConsentBanner } from '#/components/guest/cookie-consent-banner'
import type { PublicPortalLoaderData } from '#/contexts/guest/application/dto/public-portal.dto'

export const Route = createFileRoute('/p/$orgSlug/$portalSlug')({
  loader: async ({ params }): Promise<PublicPortalLoaderData | null> => {
    try {
      const portalData = await getPublicPortal({
        data: {
          orgSlug: params.orgSlug,
          portalSlug: params.portalSlug,
        },
      })
      return portalData
    } catch {
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

  if (!data) {
    return <PortalNotFound />
  }

  const { portal, categories, links } = data

  const theme = portal.theme as Record<string, string> | null
  const themeStyle = theme
    ? {
        '--portal-primary': theme.primaryColor ?? '#6366F1',
        '--portal-bg': theme.backgroundColor ?? '#ffffff',
        '--portal-text': theme.textColor ?? '#111827',
      }
    : {}

  return (
    <div
      className="min-h-screen"
      style={{
        backgroundColor: 'var(--portal-bg, #ffffff)',
        color: 'var(--portal-text, #111827)',
        ...themeStyle,
      }}
    >
      <CookieConsentBanner />

      <div className="max-w-lg mx-auto px-4 py-8 space-y-8">
        {portal.heroImageUrl && (
          <img
            src={portal.heroImageUrl}
            alt={portal.name}
            className="w-full h-48 object-cover rounded-lg"
          />
        )}

        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">{portal.name}</h1>
          <p className="text-sm text-gray-500">{portal.organizationName}</p>
        </div>

        {portal.description && (
          <p className="text-center text-gray-600">{portal.description}</p>
        )}

        <StarRating
          portalId={portal.id}
          source={
            (new URLSearchParams(window.location.search).get('source') as
              | 'qr'
              | 'nfc'
              | 'direct') ?? 'direct'
          }
        />

        <FeedbackForm
          portalId={portal.id}
          source={
            (new URLSearchParams(window.location.search).get('source') as
              | 'qr'
              | 'nfc'
              | 'direct') ?? 'direct'
          }
        />

        <div className="space-y-6">
          {categories.map((category) => {
            const categoryLinks = links.filter((l) => l.categoryId === category.id)
            return (
              <div key={category.id} className="space-y-2">
                <h2 className="text-lg font-semibold">{category.title}</h2>
                <div className="space-y-2">
                  {categoryLinks.map((link) => (
                    <a
                      key={link.id}
                      href={`/api/public/click/${link.id}`}
                      className="block p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
