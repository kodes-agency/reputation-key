// The facts that decide, per server-function call, whether a tab's code and
// the server still agree. Pure and browser-safe: the middleware that applies
// them is release-skew-middleware.ts.
//
// A tab keeps the code of the release that served its page (the
// `repkey-release` tag in the page head). A deploy replaces the server under
// it, so a tab opened before a deploy talks to newer handlers with older code.
// It sends its release with every call; the server compares it with its own
// before any handler runs.
//
// A second sign of the same thing never reaches that comparison: a tab whose
// code calls a function a deploy removed gets a plain 404 from a layer in front
// of the function middleware (unknown-server-function.ts).

export const RELEASE_HEADER = 'x-repkey-release'

/** The `code` of the refusal a stale tab gets. */
export const STALE_CLIENT_CODE = 'stale_client'

/**
 * The whole body of the plain 404 a request for a function the build lacks is
 * answered with. Text, so Start's client reads it as the error's message, and
 * why the tab can know it again by that message alone.
 */
export const UNKNOWN_SERVER_FUNCTION_BODY = 'Unknown server function'

/** A commit hash, full or abbreviated. Anything else (`unknown`, `local-dev`) names no release. */
const RELEASE = /^[0-9a-f]{7,64}$/u

/**
 * The release a value names, or undefined. Strict on purpose: the tab's value
 * arrives in a request header, and a deployment with no release configured
 * reports the word `unknown`, which must switch the whole check off.
 */
export function concreteRelease(value: unknown): string | undefined {
  return typeof value === 'string' && RELEASE.test(value) ? value : undefined
}

export type SkewAnswer =
  /** Run the call as if nothing were checked. */
  | 'proceed'
  /** Run the call and tell the tab it is stale. */
  | 'flag'
  /** Do not run the call: answer with the typed refusal. */
  | 'refuse'

/**
 * What the server does with a call. Unknown on either side means no answer is
 * possible, so the call runs: a client from before this check, a development
 * server and a test never see a refusal.
 *
 * A read from a stale tab is refused, because the answer would reach older code
 * in a newer shape (the failure that motivated this). A mutation is finished
 * and flagged: refusing it would throw away what the person just did, and
 * running it is what stale tabs already did before the check.
 */
export function answerSkew(
  input: Readonly<{ tabRelease: unknown; serverRelease: unknown; method: string }>,
): SkewAnswer {
  const tab = concreteRelease(input.tabRelease)
  const server = concreteRelease(input.serverRelease)
  if (!tab || !server || tab === server) return 'proceed'
  return input.method === 'GET' ? 'refuse' : 'flag'
}

/**
 * Whether an error is the refusal a stale tab gets. By shape, as every
 * server-function error is recognised (the class can load twice in dev), and
 * without importing the class: this module is in first paint and the class's
 * module is shared with lazy code, so importing it here would split a chunk
 * for the sake of one comparison.
 */
export function isStaleClientError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { code, status } = error as { code?: unknown; status?: unknown }
  return code === STALE_CLIENT_CODE && status === 409
}

/**
 * Whether an error is Start's client reading that 404: it throws the body as
 * the message of a plain Error. A current client never asks for an id its build
 * lacks, so this alone proves the tab's code is older than the server's. By
 * message, like `isStaleClientError` by shape, and for the same reason: nothing
 * to import into first paint.
 */
export function isUnknownServerFunctionReply(error: unknown): boolean {
  return (
    (error as { message?: unknown } | null | undefined)?.message ===
    UNKNOWN_SERVER_FUNCTION_BODY
  )
}
