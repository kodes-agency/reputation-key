// Only the code-split `_authenticated` layout imports this, so it stays out of
// first paint (scripts/check-bundle-budget.mjs). `viewport-hint` and
// `useViewportBelow` do not: the bundler puts them in a first-paint chunk.
import { useEffect } from 'react'
import { VIEWPORT_COOKIE } from './viewport-hint'

// A year: the width only has to be right for the next hard load, and the
// browser rewrites it on every visit to the app.
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

// Long enough that a window drag writes the cookie once, when it settles.
const RESIZE_SETTLE_MS = 250

export function viewportCookie(width: number, secure: boolean): string {
  const attributes = `Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`
  return `${VIEWPORT_COOKIE}=${width}; ${attributes}${secure ? '; Secure' : ''}`
}

type ResizableWindow = Readonly<{
  innerWidth: number
  addEventListener(type: 'resize', listener: () => void): void
  removeEventListener(type: 'resize', listener: () => void): void
}>

/**
 * Writes the window's width now, and again once each resize settles. Returns
 * the cleanup. One cookie serves every window of the browser, so the window
 * that mounted or resized last decides the next hard load's first paint.
 */
export function rememberViewportWidth(
  view: ResizableWindow,
  setCookie: (cookie: string) => void,
  secure: boolean,
): () => void {
  let written: number | null = null
  let settle: ReturnType<typeof setTimeout> | undefined
  const write = () => {
    const width = view.innerWidth
    if (width === written) return
    setCookie(viewportCookie(width, secure))
    written = width
  }
  const onResize = () => {
    clearTimeout(settle)
    settle = setTimeout(write, RESIZE_SETTLE_MS)
  }
  write()
  view.addEventListener('resize', onResize)
  return () => {
    clearTimeout(settle)
    view.removeEventListener('resize', onResize)
  }
}

/**
 * Keeps `VIEWPORT_COOKIE` at this window's width, so the next hard load renders
 * the layout this window will show.
 */
export function useRememberViewportWidth(): void {
  useEffect(
    () =>
      rememberViewportWidth(
        window,
        (cookie) => {
          document.cookie = cookie
        },
        window.location.protocol === 'https:',
      ),
    [],
  )
}
