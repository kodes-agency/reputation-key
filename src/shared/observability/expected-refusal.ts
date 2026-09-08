// Expected 4xx responses are product/security outcomes, not issues.
//
// One rule for every capture path: the Nitro error hook, Sentry's server
// function middleware (`beforeSend` on the server), and the browser SDK
// (`beforeSend` on the client). A wrong password, an expired session, or a
// property outside the caller's organization must never page the owner.

/** HTTP status carried by a thrown error: `status` (ours) or `statusCode` (h3). */
export function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const candidate = error as { status?: unknown; statusCode?: unknown }
  if (typeof candidate.statusCode === 'number') return candidate.statusCode
  return typeof candidate.status === 'number' ? candidate.status : undefined
}

export function isExpectedRefusal(error: unknown): boolean {
  const status = httpStatus(error)
  return status !== undefined && status < 500
}
