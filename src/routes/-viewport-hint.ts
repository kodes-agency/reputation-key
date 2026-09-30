// The viewport hint for the layout hooks (`#/components/hooks/viewport-hint`).
//
// Isomorphic rather than a server function: SSR reads the request headers in
// process, and a client-side reload of the loader costs no round trip. There is
// no client implementation, so the browser gets `undefined`: hydration reuses
// the loader data the server dehydrated, and once hydrated the hooks read
// `matchMedia` instead. It also keeps the hint parser out of the route config,
// which is first-paint code (scripts/check-bundle-budget.mjs).
//
// No `Sec-CH-Viewport-Width`: it is Chromium-only and has to be requested with
// `Accept-CH` first, so it never arrives on the first request. The cookie the
// authenticated layout writes gives the same number in every browser.
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import {
  viewportHintFromRequest,
  type ViewportHint,
} from '#/components/hooks/viewport-hint'

export const readViewportHint = createIsomorphicFn().server((): ViewportHint =>
  viewportHintFromRequest({
    cookie: getRequestHeader('cookie'),
    uaMobile: getRequestHeader('sec-ch-ua-mobile'),
    userAgent: getRequestHeader('user-agent'),
  }),
)
