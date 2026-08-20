import { GuestResponseForm, type GuestResponseFormProps } from './guest-response-form'

export type PortalCategory = {
  id: string
  title: string
}

export type PortalLinkItem = {
  id: string
  label: string
  url: string
  categoryId: string | null
}

export type PublicPortalContentProps = Readonly<{
  /** Omitted only by authenticated manager previews. Public pages must supply it. */
  token?: string
  portal: {
    id: string
    name: string
    description: string | null
    organizationName: string
    heroImageUrl: string | null
    theme: Record<string, string | number | boolean | null> | null
  }
  categories: ReadonlyArray<PortalCategory>
  links: ReadonlyArray<PortalLinkItem>
  responseForm?: Omit<GuestResponseFormProps, 'token'>
}>

export function PublicPortalContent({
  token,
  portal,
  categories,
  links,
  responseForm,
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
      <div className="mx-auto max-w-lg space-y-8 px-4 py-8">
        {portal.heroImageUrl && (
          <img
            src={portal.heroImageUrl}
            alt=""
            className="h-48 w-full rounded-lg object-cover"
          />
        )}

        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">{portal.name}</h1>
          <p className="text-sm text-gray-500">{portal.organizationName}</p>
        </div>

        {portal.description && (
          <p className="text-center text-gray-600">{portal.description}</p>
        )}

        <nav aria-label="Review destinations" className="space-y-6">
          {categories.map((category) => {
            const categoryLinks = links.filter((link) => link.categoryId === category.id)
            if (categoryLinks.length === 0) return null
            return (
              <section key={category.id} className="space-y-2">
                <h2 className="text-lg font-semibold">{category.title}</h2>
                <div className="space-y-2">
                  {categoryLinks.map((link) => (
                    <a
                      key={link.id}
                      href={
                        token
                          ? `/api/public/p/${encodeURIComponent(token)}/click/${link.id}`
                          : link.url
                      }
                      rel="noreferrer"
                      className="block rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2"
                      style={{ color: 'inherit' }}
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              </section>
            )
          })}
          {links.some((link) => link.categoryId === null) && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">More destinations</h2>
              <div className="space-y-2">
                {links
                  .filter((link) => link.categoryId === null)
                  .map((link) => (
                    <a
                      key={link.id}
                      href={
                        token
                          ? `/api/public/p/${encodeURIComponent(token)}/click/${link.id}`
                          : link.url
                      }
                      rel="noreferrer"
                      className="block rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2"
                      style={{ color: 'inherit' }}
                    >
                      {link.label}
                    </a>
                  ))}
              </div>
            </section>
          )}
        </nav>

        {token && responseForm && <GuestResponseForm token={token} {...responseForm} />}
      </div>
    </div>
  )
}
