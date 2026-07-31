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
 * explicitly by the caller (router.tsx passes `import.meta.env.PROD`) so the
 * decision stays unit-testable.
 */
export function publicErrorMessage(error: Error, isProduction: boolean): string {
  if (isProduction) return GENERIC_CLIENT_ERROR_MESSAGE
  return error.message || GENERIC_CLIENT_ERROR_MESSAGE
}
