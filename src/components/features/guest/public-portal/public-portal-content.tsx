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

// `--portal-primary` is the manager's accent: it is the only colour the settings
// UI has ever let them change, and until now nothing on this page read it. It
// drives the section headings, the destination rules and the focus ring below.
const DESTINATION_CLASS =
  'block rounded-lg border border-l-4 p-3 transition-colors hover:[background-color:var(--portal-accent-soft)] focus-visible:ring-2 focus-visible:ring-[color:var(--portal-primary)] focus-visible:outline-none'

const DESTINATION_STYLE = {
  borderColor: 'var(--portal-accent-border)',
  borderLeftColor: 'var(--portal-primary)',
  color: 'inherit',
}

const HEADING_STYLE = { color: 'var(--portal-primary)' }

export function PublicPortalContent({
  token,
  portal,
  categories,
  links,
  responseForm,
}: PublicPortalContentProps) {
  // The stored theme is an open JSON record, so each colour is narrowed rather
  // than asserted; the fallbacks match the domain default theme (#6366F1).
  const primaryColor =
    typeof portal.theme?.primaryColor === 'string' ? portal.theme.primaryColor : '#6366F1'
  const backgroundColor =
    typeof portal.theme?.backgroundColor === 'string'
      ? portal.theme.backgroundColor
      : '#ffffff'
  const textColor =
    typeof portal.theme?.textColor === 'string' ? portal.theme.textColor : '#111827'

  const themeStyle = {
    '--portal-primary': primaryColor,
    '--portal-bg': backgroundColor,
    '--portal-text': textColor,
    // Derived tints so surfaces and rules track the accent instead of the
    // hardcoded grays that used to make the Dark palette unreadable.
    '--portal-accent-soft': `color-mix(in srgb, ${primaryColor} 12%, transparent)`,
    '--portal-accent-border': `color-mix(in srgb, ${primaryColor} 40%, transparent)`,
  }

  const uncategorizedLinks = links.filter((link) => link.categoryId === null)

  return (
    <div
      className="min-h-screen"
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
          <div
            className="mx-auto h-1 w-12 rounded-full"
            style={{ backgroundColor: 'var(--portal-primary)' }}
            aria-hidden
          />
          <p className="text-sm opacity-70">{portal.organizationName}</p>
        </div>

        {portal.description && (
          <p className="text-center opacity-80">{portal.description}</p>
        )}

        {links.length === 0 ? (
          // A published portal with no destinations used to render a bare title
          // and nothing else: every category mapped to null and there was no
          // fallback. The server now refuses to publish an empty portal, so this
          // covers the residual case — links removed after publication.
          <div
            role="status"
            className="rounded-lg border border-dashed p-6 text-center"
            style={{ borderColor: 'var(--portal-accent-border)' }}
          >
            <p className="font-medium">No review destinations yet</p>
            <p className="mt-1 text-sm opacity-70">
              {portal.organizationName} has not added anywhere to leave a review on this
              page yet.
              {token && responseForm
                ? ' You can still send your feedback directly below.'
                : ''}
            </p>
          </div>
        ) : (
          <nav aria-label="Review destinations" className="space-y-6">
            {categories.map((category) => {
              const categoryLinks = links.filter((link) => link.categoryId === category.id)
              if (categoryLinks.length === 0) return null
              return (
                <section key={category.id} className="space-y-2">
                  <h2 className="text-lg font-semibold" style={HEADING_STYLE}>
                    {category.title}
                  </h2>
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
                        className={DESTINATION_CLASS}
                        style={DESTINATION_STYLE}
                      >
                        {link.label}
                      </a>
                    ))}
                  </div>
                </section>
              )
            })}
            {uncategorizedLinks.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-lg font-semibold" style={HEADING_STYLE}>
                  More destinations
                </h2>
                <div className="space-y-2">
                  {uncategorizedLinks.map((link) => (
                    <a
                      key={link.id}
                      href={
                        token
                          ? `/api/public/p/${encodeURIComponent(token)}/click/${link.id}`
                          : link.url
                      }
                      rel="noreferrer"
                      className={DESTINATION_CLASS}
                      style={DESTINATION_STYLE}
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              </section>
            )}
          </nav>
        )}

        {token && responseForm && <GuestResponseForm token={token} {...responseForm} />}
      </div>
    </div>
  )
}
