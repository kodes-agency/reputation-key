// Shared server function error helpers.
// Per conventions: "shared/ gets code when a second context needs it."
// Property and team server functions both use identical error→HTTP translation + throw patterns.

/**
 * Throw an Error object suitable for TanStack Start's seroval serialization.
 * The client-side mutation will receive this as `mutation.error`.
 *
 * Per architecture: "Server functions catch tagged errors and throw Error objects
 * with .name, .message, .code, and .status properties."
 */
export function throwContextError(
  errorName: string,
  e: { code: string; message: string },
  status: number,
): never {
  const error = new Error(e.message)
  error.name = errorName
  ;(error as unknown as Record<string, unknown>).code = e.code
  ;(error as unknown as Record<string, unknown>).status = status
  throw error
}
