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
  reviewGateway?: Readonly<{
    privateFeedbackThreshold: number
    googleReviewUri: string
  }>
  responseForm?: Omit<GuestResponseFormProps, 'token' | 'googleReviewUri'>
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

/** Secondary text. See `--portal-text-muted` for why this is not `opacity-*`. */
const MUTED_STYLE = { color: 'var(--portal-text-muted)' }

export function PublicPortalContent({
  token,
  portal,
  categories,
  links,
  reviewGateway,
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
    // Secondary text is mixed toward the portal's OWN background rather than
    // dimmed with `opacity-*`. Opacity composites against whatever happens to
    // be painted behind the element, so a preview rendered on a dark surface
    // produced dark-on-dark text (axe measured 1.08:1). Mixing on the
    // text→background axis yields an opaque colour whose contrast is a property
    // of the palette, not of the container.
    '--portal-text-muted': `color-mix(in srgb, ${textColor} 72%, ${backgroundColor})`,
  }

  const uncategorizedLinks = links.filter((link) => link.categoryId === null)
  const secondaryLinks =
    links.length > 0 ? (
      <nav aria-label="More links" className="space-y-6">
        <h2 className="text-lg font-semibold" style={HEADING_STYLE}>
          More from {portal.organizationName}
        </h2>
        {categories.map((category) => {
          const categoryLinks = links.filter((link) => link.categoryId === category.id)
          if (categoryLinks.length === 0) return null
          return (
            <section key={category.id} className="space-y-2">
              <h3 className="text-lg font-semibold" style={HEADING_STYLE}>
                {category.title}
              </h3>
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
            <h3 className="text-lg font-semibold" style={HEADING_STYLE}>
              More destinations
            </h3>
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
    ) : null

  const isPublicPortal = token !== undefined
  const publicGatewayReady =
    isPublicPortal && responseForm !== undefined && reviewGateway !== undefined

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
          <p className="text-sm" style={MUTED_STYLE}>
            {portal.organizationName}
          </p>
        </div>

        {portal.description && (
          <p className="text-center" style={MUTED_STYLE}>
            {portal.description}
          </p>
        )}

        {publicGatewayReady ? (
          <GuestResponseForm
            token={token}
            googleReviewUri={reviewGateway.googleReviewUri}
            secondaryLinks={secondaryLinks}
            {...responseForm}
          />
        ) : isPublicPortal ? (
          <section role="status" className="rounded-lg border p-5 text-center">
            <h2 className="font-semibold">Review gateway temporarily unavailable</h2>
            <p className="mt-2 text-sm">Please try again in a little while.</p>
          </section>
        ) : (
          <>
            <section className="rounded-lg border p-5 text-center">
              <h2 className="text-lg font-semibold">How was your experience?</h2>
              <p className="mt-1 text-sm" style={MUTED_STYLE}>
                Guests start with a private 1–5 star rating. Google follows after the
                rating, with private feedback offered when eligible.
              </p>
            </section>
            {secondaryLinks}
          </>
        )}
      </div>
    </div>
  )
}
