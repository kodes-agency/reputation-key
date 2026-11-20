import { guestDocumentTitle } from './public-portal/guest-title'

/** What the document head of a guest page is written from. */
export type GuestPageHeadPortal = Readonly<{
  /** The portal's title in the page's language. */
  name: string
  /** The property's display name. */
  organizationName: string
  description: string | null
  heroImageUrl: string | null
}>

type GuestPageMeta =
  | Readonly<{ title: string }>
  | Readonly<{ name: string; content: string }>
  | Readonly<{ property: string; content: string }>

/**
 * The head of `/p/$token`. The opaque token is the entire access control for a
 * guest portal, so the page must never be indexable, whatever its publication
 * state and in addition to the `Disallow: /p/` in robots.txt (the meta tag
 * covers crawlers that fetch the URL anyway). Deliberately no canonical URL:
 * canonicalising a secret-token URL would republish the token to every consumer
 * of the page.
 *
 * With no portal it is the one "unavailable" head, the same for every reason.
 */
export function guestPageHead(portal: GuestPageHeadPortal | null): {
  meta: GuestPageMeta[]
} {
  const robots = { name: 'robots', content: 'noindex, nofollow' }
  if (!portal) return { meta: [{ title: 'Page unavailable' }, robots] }
  const description = portal.description ?? ''
  return {
    meta: [
      { title: guestDocumentTitle(portal.name, portal.organizationName) },
      robots,
      { name: 'description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: portal.name },
      { property: 'og:description', content: description },
      // QR portals are shared into WhatsApp/iMessage/Slack far more often than
      // they are browsed, so the hero image is the preview that matters.
      ...(portal.heroImageUrl
        ? [
            { property: 'og:image', content: portal.heroImageUrl },
            { name: 'twitter:card', content: 'summary_large_image' },
          ]
        : [{ name: 'twitter:card', content: 'summary' }]),
    ],
  }
}
