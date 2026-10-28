// The person's choice of sidebar, as a cookie.
//
// The server reads it with the request so the first paint is already the width
// the person chose (a hard load of a page with the sidebar collapsed draws the
// icon rail, not 256 px that then snap shut). The browser writes it each time the
// person toggles. It holds `true` (open) or `false` (collapsed); anything else,
// or no cookie, means the default, which is open.

const SIDEBAR_COOKIE = 'sidebar_state'

/** A year: a choice about how the app looks is not something to ask again weekly. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/**
 * The open state a `Cookie` header (or `document.cookie`) carries, or `null` when
 * it carries none or one that is not exactly `true` or `false`.
 */
export function sidebarOpenFromCookie(header: string | null | undefined): boolean | null {
  if (!header) return null
  const value = header
    .split(';')
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(`${SIDEBAR_COOKIE}=`))
    ?.slice(SIDEBAR_COOKIE.length + 1)
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

/** The `document.cookie` assignment that remembers `open`; `Secure` only over https. */
export function sidebarCookie(open: boolean, secure: boolean): string {
  return `${SIDEBAR_COOKIE}=${open}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${
    secure ? '; Secure' : ''
  }`
}
