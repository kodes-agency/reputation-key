import type { SelectSecondaryLinkAction } from './guest-response-form-types'
import { bindLinkTapCounter } from './immersive/linktree-follow'
import { trackedLinkHref } from './portal-link-href'
import {
  getGuestPortalCopy,
  type GuestPortalLanguagePackVersion,
  type GuestPortalLocale,
} from './guest-language-pack'

export type PortalCategory = Readonly<{ id: string; title: string }>
export type PortalLinkItem = Readonly<{
  id: string
  label: string
  /** Present in authenticated previews; public pages navigate by token + link ID. */
  url?: string
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

export function PortalSecondaryLinks({
  token,
  csrfNonce,
  organizationName,
  categories,
  links,
  selectSecondaryLink,
  locale = 'en',
  languagePackVersion,
}: Readonly<{
  token?: string
  csrfNonce?: string
  organizationName: string
  categories: ReadonlyArray<PortalCategory>
  links: ReadonlyArray<PortalLinkItem>
  selectSecondaryLink?: SelectSecondaryLinkAction
  locale?: GuestPortalLocale
  languagePackVersion?: GuestPortalLanguagePackVersion
}>) {
  if (links.length === 0) return null
  const copy = getGuestPortalCopy(locale, languagePackVersion)
  const destinationHref = (link: PortalLinkItem) =>
    token ? trackedLinkHref(token, link.id) : (link.url ?? '#')
  const countTap = bindLinkTapCounter({ token, csrfNonce, selectSecondaryLink })
  const renderLink = (link: PortalLinkItem) => (
    <a
      key={link.id}
      href={destinationHref(link)}
      onClick={countTap ? () => countTap(link.id) : undefined}
      rel="noreferrer"
      className={DESTINATION_CLASS}
      style={DESTINATION_STYLE}
    >
      {link.label}
    </a>
  )
  const uncategorized = links.filter((link) => link.categoryId === null)

  return (
    <nav aria-label={copy.moreLinksLabel} className="space-y-6">
      <h2 className="text-lg font-semibold" style={HEADING_STYLE}>
        {copy.moreFrom(organizationName)}
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
            {copy.moreDestinations}
          </h3>
          <div className="space-y-2">{uncategorized.map(renderLink)}</div>
        </section>
      )}
    </nav>
  )
}
