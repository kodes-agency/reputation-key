// Shared helper — build request headers from the current TanStack Start server context.
// Used by server functions and the auth identity adapter to pass session cookies
// to better-auth server APIs that authenticate via cookies.

import { getRequest } from '@tanstack/react-start/server'

/** Build a Headers object carrying the current request's cookies and headers. */
export function headersFromContext(): Headers {
  const headers = new Headers()
  const req = getRequest()
  if (req) {
    req.headers.forEach((value: string, key: string) => {
      headers.set(key, value)
    })
  }
  return headers
}
