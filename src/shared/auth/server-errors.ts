// Shared server function error helpers.
// Per conventions: server functions catch tagged errors and throw Error objects
// with .name, .message, .code, and .status properties for TanStack Start's seroval serialization.

/**
 * Error class for server function boundaries.
 * Extends Error with typed _tag, code, and status properties.
 * Per architecture: "always tagged errors" — this is the server-boundary
 * representation that gets serialized via seroval to the client mutation error.
 */
class ServerFunctionError extends Error {
  readonly _tag: string
  readonly code: string
  readonly status: number

  constructor(errorName: string, message: string, code: string, status: number) {
    super(message)
    this.name = errorName
    this._tag = errorName
    this.code = code
    this.status = status
  }
}

/**
 * Throw a ServerFunctionError — used by all context server functions
 * to translate tagged domain errors into HTTP-appropriate Error objects.
 */
export function throwContextError(
  errorName: string,
  e: { code: string; message: string },
  status: number,
): never {
  throw new ServerFunctionError(errorName, e.message, e.code, status)
}
