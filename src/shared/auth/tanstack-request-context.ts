// Shared auth — the ONE TanStack Start request-context adapter.
//
// ARC-03-T13: this used to exist twice, as `headersFromContext()` in
// shared/auth/headers.ts and as a private `headersFromRequest()` inside the
// better-auth identity adapter. Two copies of a framework escape hatch is two
// places to forget the try/catch that makes worker and job processes work.
//
// The dynamic import is deliberate: a static `@tanstack/react-start/server`
// edge would put the server runtime in the client module graph and trip
// TanStack's import protection. Keeping it here means exactly one module in the
// system owns that trade-off.

/**
 * The shape shared/auth provides, named here rather than imported from the
 * Identity context: shared may not depend on a context. Identity declares its
 * own RequestContextPort with the same shape, and the composition root wires
 * the two together — so if either side drifts, the root stops compiling, which
 * is exactly the contract check this seam needs.
 */
export type RequestHeadersProvider = Readonly<{
  currentRequestHeaders: () => Promise<Headers>
}>

export type TanstackRequestContextDeps = Readonly<{
  /**
   * Called when no server request context exists. This is the NORMAL state in
   * a worker or job process, so it is an observation, never an error.
   */
  observeAbsentRequest?: (error: unknown) => void
}>

export function createTanstackRequestContext(
  deps: TanstackRequestContextDeps = {},
): RequestHeadersProvider {
  return Object.freeze({
    currentRequestHeaders: async (): Promise<Headers> => {
      const headers = new Headers()
      try {
        const { getRequest } = await import('@tanstack/react-start/server')
        const request = getRequest()
        if (request) {
          // `forEach` yields one already-combined value per header name, so
          // `set` and `append` are equivalent against a fresh Headers.
          request.headers.forEach((value: string, key: string) => {
            headers.set(key, value)
          })
        }
      } catch (error) {
        deps.observeAbsentRequest?.(error)
      }
      return headers
    },
  })
}
