import { StarRating } from './star-rating'
import { FeedbackForm } from './feedback-form'
import type { ScanSource } from '#/contexts/guest/application/dto/public-portal.dto'

export type PortalCategory = {
  id: string
  title: string
}

export type PortalLinkItem = {
  id: string
  label: string
  url: string
  categoryId: string
}

export type PublicPortalContentProps = Readonly<{
  portal: {
    id: string
    name: string
    description: string | null
    organizationName: string
    heroImageUrl: string | null
    theme: Record<string, string | number | boolean | null> | null
  }
  categories: PortalCategory[]
  links: PortalLinkItem[]
  source?: ScanSource
  submitFeedback?: (input: {
    data: {
      portalId: string
      comment: string
      source: ScanSource
      honeypot: string
      submittedAt: number
    }
  }) => Promise<unknown>
  submitRating?: (input: {
    data: { portalId: string; value: number; source: ScanSource }
  }) => Promise<unknown>
}>

export function PublicPortalContent({
  portal,
  categories,
  links,
  source = 'direct',
  submitFeedback,
  submitRating,
}: PublicPortalContentProps) {
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
      className="portal-preview-root min-h-screen"
      style={{
        backgroundColor: 'var(--portal-bg, #ffffff)',
        color: 'var(--portal-text, #111827)',
        ...themeStyle,
      }}
    >
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

        <StarRating portalId={portal.id} source={source} submitRating={submitRating} />

        <FeedbackForm
          portalId={portal.id}
          source={source}
          submitFeedback={submitFeedback}
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
