// Client-side error display sanitization (BQC-7.6).
//
// Root/route error boundaries must not render raw error messages in
// production: loader and server-fn failures can carry SQL fragments,
// filesystem paths, or config values into the DOM. Production renders a
// generic message; development keeps the raw message for debuggability.
// (Server-side error mapping already fails closed — catchUntagged in
// src/shared/auth/server-errors.ts maps everything untagged to a generic
// InternalError; this is the client-boundary half.)

/** The only error text a production client ever sees from a boundary. */
export const GENERIC_CLIENT_ERROR_MESSAGE = 'Something went wrong loading this page.'

/**
 * Message safe to render at an error boundary. `isProduction` is passed
 * explicitly by the caller (the route boundaries pass `import.meta.env.PROD`)
 * so the decision stays unit-testable.
 *
 * `fallback` is the sentence to show when the raw message must not be (always
 * in production) or does not exist. It is a static string the page wrote, never
 * derived from the error, so a page can say "Portals could not be loaded."
 * without opening the leak this function exists to close.
 */
export function publicErrorMessage(
  error: unknown,
  isProduction: boolean,
  fallback: string = GENERIC_CLIENT_ERROR_MESSAGE,
): string {
  if (isProduction) return fallback
  return errorMessage(error) || fallback
}

/**
 * The message a thrown value carries, if any. Router error components receive
 * `unknown`: a route can throw a string, a plain object, or nothing useful.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : ''
}
