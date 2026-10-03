// What the server can know about the browser's viewport before any client code
// runs. Layout hooks answer from it during the server render and hydration, so
// a hard load on a phone paints the phone layout instead of the desktop one.
// After hydration the hooks read `matchMedia` and the hint no longer matters.

export type ViewportHint = Readonly<{
  /** CSS px width the browser last reported, from `VIEWPORT_COOKIE`. */
  width: number | null
  /** The browser says it is a phone (client hint or user agent). */
  mobile: boolean
}>

export const UNKNOWN_VIEWPORT: ViewportHint = { width: null, mobile: false }

/** Written by the browser (`useRememberViewportWidth`), read by the server. */
export const VIEWPORT_COOKIE = 'rk_viewport'

// The narrowest phones in use are 280 px; nothing renders 16384 CSS px wide.
// Anything outside is a tampered or corrupt value and is ignored.
const MIN_WIDTH = 200
const MAX_WIDTH = 16_384

const WIDTH_PATTERN = /^\d{3,5}$/

// MDN's advice for mobile detection: every major phone browser puts "Mobi" in
// its user agent, and tablets do not. iPadOS sends a desktop user agent, so an
// iPad without a cookie is treated as a desktop, as it was before.
const MOBILE_USER_AGENT = /Mobi/

export type ViewportRequest = Readonly<{
  cookie?: string | null
  /** The `Sec-CH-UA-Mobile` header, which Chromium sends unasked. */
  uaMobile?: string | null
  userAgent?: string | null
}>

export function viewportHintFromRequest(request: ViewportRequest): ViewportHint {
  const width = widthFromCookie(request.cookie)
  const mobile =
    request.uaMobile === '?1' ||
    (request.uaMobile !== '?0' && MOBILE_USER_AGENT.test(request.userAgent ?? ''))
  if (width === null && !mobile) return UNKNOWN_VIEWPORT
  return { width, mobile }
}

/**
 * Is the hinted viewport narrower than `breakpointPx`, as the
 * `(max-width: breakpointPx - 1px)` query the hooks use would answer?
 * A phone that has not reported its width is assumed to be in portrait, which
 * is narrower than every app breakpoint.
 */
export function isHintBelow(hint: ViewportHint, breakpointPx: number): boolean {
  if (hint.width !== null) return hint.width < breakpointPx
  return hint.mobile
}

function widthFromCookie(header: string | null | undefined): number | null {
  if (!header) return null
  const value = header
    .split(';')
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(`${VIEWPORT_COOKIE}=`))
    ?.slice(VIEWPORT_COOKIE.length + 1)
  if (value === undefined || !WIDTH_PATTERN.test(value)) return null
  const width = Number(value)
  return width >= MIN_WIDTH && width <= MAX_WIDTH ? width : null
}
