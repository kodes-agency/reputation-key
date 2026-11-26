import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import type { CommandError, CommandErrors } from '#/shared/commands/contracts'

const isStaffAccountFailure = (error: unknown): error is CommandError =>
  typeof error === 'object' &&
  error !== null &&
  '_tag' in error &&
  ['StaffAccountError', 'PortalError'].includes(String(error._tag)) &&
  'code' in error &&
  'message' in error

const staffAccountStatus = (code: string): number =>
  code === 'forbidden'
    ? 403
    : code === 'rate_limited'
      ? 429
      : code === 'participation_not_found'
        ? 404
        : 409

/** The error map the Staff `command()` handlers share. */
export const staffAccountCommandErrors = {
  name: 'StaffAccountError',
  is: isStaffAccountFailure,
  status: staffAccountStatus,
} satisfies CommandErrors<CommandError>

export function rethrowStaffAccount(error: unknown): never {
  if (isStaffAccountFailure(error)) {
    throwContextError(
      'StaffAccountError',
      { code: String(error.code), message: String(error.message) },
      staffAccountStatus(String(error.code)),
    )
  }
  throw catchUntagged(error)
}
