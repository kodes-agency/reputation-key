import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import type { CommandError, CommandErrors } from '#/shared/commands/contracts'

const STAFF_ACCOUNT_ERROR_TAGS = ['StaffAccountError', 'PortalError']

const isStaffAccountError = (error: unknown): error is CommandError =>
  typeof error === 'object' &&
  error !== null &&
  '_tag' in error &&
  STAFF_ACCOUNT_ERROR_TAGS.includes(String(error._tag)) &&
  'code' in error &&
  'message' in error

const staffAccountErrorStatus = (code: string): number =>
  code === 'forbidden'
    ? 403
    : code === 'rate_limited'
      ? 429
      : code === 'participation_not_found'
        ? 404
        : 409

/** The error mapping `command()` applies to the staff account handlers. */
export const staffAccountCommandErrors: CommandErrors<CommandError> = {
  name: 'StaffAccountError',
  is: isStaffAccountError,
  status: staffAccountErrorStatus,
}

export function rethrowStaffAccount(error: unknown): never {
  if (isStaffAccountError(error)) {
    throwContextError(
      staffAccountCommandErrors.name,
      { code: String(error.code), message: String(error.message) },
      staffAccountErrorStatus(String(error.code)),
    )
  }
  throw catchUntagged(error)
}
