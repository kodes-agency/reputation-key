import type { MouseEvent } from 'react'
import type { GuestResponseAction } from './guest-response-form'

export type PortalCategory = Readonly<{ id: string; title: string }>
export type PortalLinkItem = Readonly<{
  id: string
  label: string
  url: string
  categoryId: string | null
}>

const DESTINATION_CLASS =
  'block rounded-lg border border-l-4 p-3 transition-colors hover:[background-color:var(--portal-accent-soft)] focus-visible:ring-2 focus-visible:ring-[color:var(--portal-primary)] focus-visible:outline-none'
const DESTINATION_STYLE = {
  borderColor: 'var(--portal-accent-border)',
  borderLeftColor: 'var(--portal-primary)',
  color: 'inherit',
}
const HEADING_STYLE = { color: 'var(--portal-primary)' }

type SelectSecondaryLink = GuestResponseAction<
  { token: string; csrfNonce: string; linkId: string },
  { url: string }
>

export function PortalSecondaryLinks({
  token,
  csrfNonce,
  organizationName,
  categories,
  links,
  selectSecondaryLink,
}: Readonly<{
  token?: string
  csrfNonce?: string
  organizationName: string
  categories: ReadonlyArray<PortalCategory>
  links: ReadonlyArray<PortalLinkItem>
  selectSecondaryLink?: SelectSecondaryLink
}>) {
  if (links.length === 0) return null
  const destinationHref = (link: PortalLinkItem) =>
    token ? `/api/public/p/${encodeURIComponent(token)}/click/${link.id}` : link.url
  const selectDestination = (
    event: MouseEvent<HTMLAnchorElement>,
    link: PortalLinkItem,
  ) => {
    if (!token || !csrfNonce || !selectSecondaryLink) return
    event.preventDefault()
    const fallback = destinationHref(link)
    void selectSecondaryLink({ data: { token, csrfNonce, linkId: link.id } })
      .then((result) => window.location.assign(result.url))
      .catch(() => window.location.assign(fallback))
  }
  const renderLink = (link: PortalLinkItem) => (
    <a
      key={link.id}
      href={destinationHref(link)}
      onClick={(event) => selectDestination(event, link)}
      rel="noreferrer"
      className={DESTINATION_CLASS}
      style={DESTINATION_STYLE}
    >
      {link.label}
    </a>
  )
  const uncategorized = links.filter((link) => link.categoryId === null)

  return (
    <nav aria-label="More links" className="space-y-6">
      <h2 className="text-lg font-semibold" style={HEADING_STYLE}>
        More from {organizationName}
      </h2>
      {categories.map((category) => {
        const members = links.filter((link) => link.categoryId === category.id)
        if (members.length === 0) return null
        return (
          <section key={category.id} className="space-y-2">
            <h3 className="text-lg font-semibold" style={HEADING_STYLE}>
              {category.title}
            </h3>
            <div className="space-y-2">{members.map(renderLink)}</div>
          </section>
        )
      })}
      {uncategorized.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-lg font-semibold" style={HEADING_STYLE}>
            More destinations
          </h3>
          <div className="space-y-2">{uncategorized.map(renderLink)}</div>
        </section>
      )}
    </nav>
  )
}
