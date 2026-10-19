// What a request for a server function this build does not have is answered with.
//
// Start looks the function up by the id in the path (`/_serverFn/<id>`) as the
// first thing its terminal handler does, and throws when the id is not in the
// build's manifest. That throw sits below every request middleware, so Sentry's
// own request middleware, the outermost, captured it as an unhandled error and
// the caller got a bare 500. Who asks:
//   - a probe or a bot, with any id at all;
//   - a tab whose code names a function a deploy removed or renamed. Production
//     ids are a hash of the file and function name, so they survive a deploy that
//     leaves the function where it was, and only a change to the function itself
//     makes an older tab ask for one the server no longer has.
// Neither is a fault of the server, and neither can be fixed from an issue.
//
// The release check cannot answer for the second kind: it runs as function
// middleware, after the lookup that failed. This is the request-level answer in
// front of it: a plain 404 that names nothing of the request, returned instead
// of an exception, so no middleware outside it has anything to capture. The
// error handler of the Nitro layer never sees one either.

import { createMiddleware } from '@tanstack/react-start'

/** The whole body of the answer. Text, so Start's client reads it as the error's message. */
export const UNKNOWN_SERVER_FUNCTION_BODY = 'Unknown server function'

/** How Start's generated resolver words the lookup that found nothing. Pinned by this module's tests. */
const MISSING_FUNCTION = 'Server function info not found for '

/** Whether an error is the resolver's "no such function" and nothing else it can throw. */
export function isUnknownServerFunctionError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(MISSING_FUNCTION)
}

/**
 * Whether an id can only be an unknown one: a name every object inherits.
 * Start reads its manifest, a plain object, by the id in the path, so
 * `constructor` or `__proto__` finds something there and fails further on, with
 * an error that says nothing about a missing function. Real ids are hashes.
 */
export function isUnknownServerFunctionId(id: string | undefined): boolean {
  return id !== undefined && id in Object.prototype
}

/** The id in `/_serverFn/<id>`: the segment after the base, as Start reads it. */
function requestedId(pathname: string): string | undefined {
  return pathname.split('/')[2]
}

function unknownServerFunction(): Response {
  return new Response(UNKNOWN_SERVER_FUNCTION_BODY, {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export const unknownServerFunctionMiddleware = createMiddleware({
  type: 'request',
}).server(async ({ handlerType, pathname, next }) => {
  if (handlerType !== 'serverFn') return next()
  if (isUnknownServerFunctionId(requestedId(pathname))) return unknownServerFunction()
  try {
    return await next()
  } catch (error) {
    // Anything else Start or a function throws goes on to be reported.
    if (isUnknownServerFunctionError(error)) return unknownServerFunction()
    throw error
  }
})
