import { isServerFunctionError } from '#/shared/auth/server-function-error'

/**
 * Sign-in says so, and only after the password checked out, when the address
 * is not verified. The login page answers that with a way to get a new link
 * rather than a generic failure.
 */
export function isEmailNotVerified(error: unknown): boolean {
  return isServerFunctionError(error) && error.code === 'email_not_verified'
}
