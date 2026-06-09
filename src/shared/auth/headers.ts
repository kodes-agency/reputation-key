// Shared helper — build request headers from the current TanStack Start server context.
// Used by server functions and the auth identity adapter to pass session cookies
// to better-auth server APIs that authenticate via cookies.
//
// Uses dynamic import to avoid @tanstack/react-start/server being part of
// the static module graph, which triggers TanStack's client-side import protection.
// This allows the module to be safely imported from composition.ts which is
// reachable from both client and server code.

/** Build a Headers object carrying the current request's cookies and headers. */
export async function headersFromContext(): Promise<Headers> {
  const headers = new Headers()
  try {
    const { getRequest } = await import('@tanstack/react-start/server')
    const req = getRequest()
    if (req) {
      req.headers.forEach((value: string, key: string) => {
        headers.append(key, value)
      })
    }
  } catch {
    // Outside server context (e.g., worker) — return empty headers
  }
  return headers
}
