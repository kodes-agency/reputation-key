/**
 * Sign-in says so, and only after the password checked out, when the address
 * is not verified. The login page answers that with a way to get a new link
 * rather than a generic failure.
 *
 * Recognised by shape (an Error carrying the server's `code`), the way
 * `isServerFunctionError` does, without importing it: that module is part of
 * first paint, and a second, lazy importer would split it into a chunk of its
 * own in the budgeted initial closure.
 */
export function isEmailNotVerified(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as Error & { code?: unknown }).code === 'email_not_verified'
  )
}
