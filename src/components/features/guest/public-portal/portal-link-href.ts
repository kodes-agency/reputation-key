/**
 * The navigation-only click route of a published link. It resolves the link's
 * destination on the server and redirects, so a page never holds a destination
 * URL, and it never records a qualified action: only the origin- and session-
 * bound server action does that.
 */
export function trackedLinkHref(token: string, linkId: string): string {
  return `/api/public/p/${encodeURIComponent(token)}/click/${linkId}`
}
