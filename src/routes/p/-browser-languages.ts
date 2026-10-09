// The languages the visitor's own browser asks for, for the unavailable page.
//
// Isomorphic rather than a server function, like `-viewport-hint`: SSR reads the
// request's `Accept-Language` in process, and a client-side navigation reads
// `navigator.languages`. No round trip, and nothing about any portal: the page
// must say the same thing for every reason it is not there.
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'

export const readBrowserLanguages = createIsomorphicFn()
  .server(
    (): string | readonly string[] | null => getRequestHeader('accept-language') ?? null,
  )
  .client((): string | readonly string[] | null =>
    typeof navigator === 'undefined' ? null : navigator.languages,
  )
