// Shared helper — build request headers from the current TanStack Start server
// context. Used by server functions that pass session cookies to better-auth
// server APIs which authenticate via cookies.
//
// ARC-03-T13: the implementation now lives in the ONE request-context adapter
// (tanstack-request-context.ts). This stays as the ergonomic call shape for
// request-scoped server functions, which already run inside a request; anything
// that is composed into a container takes the RequestContextPort instead.

import { createTanstackRequestContext } from './tanstack-request-context'

const requestContext = createTanstackRequestContext()

/** Build a Headers object carrying the current request's cookies and headers. */
export async function headersFromContext(): Promise<Headers> {
  return requestContext.currentRequestHeaders()
}
