// The person's choice of sidebar, as a cookie.
//
// The server reads it so the first paint is already the chosen width (no 256 px
// sidebar snapping shut). The browser writes it on each toggle. It holds `true`
// (open) or `false` (collapsed); anything else, or no cookie, means open.

const SIDEBAR_COOKIE = 'sidebar_state'

/** A year: a choice about how the app looks is not something to ask again weekly. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/** The open state a cookie string carries, or `null` when absent or not exactly `true`/`false`. */
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
