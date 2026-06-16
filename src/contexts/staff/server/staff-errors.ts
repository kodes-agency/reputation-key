// Staff context — error → HTTP status mapping.
// Extracted into its own module so the server function files can share it
// without forming a circular import (staff-assignments.ts ↔ staff-portals-update.ts).

import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
import type { StaffErrorCode } from '../application/public-api'

export const staffErrorStatus = (code: StaffErrorCode): number =>
  match(code)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with(
      'assignment_not_found',
      'property_not_found',
      'team_not_found',
      () => HTTP_STATUS.NOT_FOUND,
    )
    .with('already_assigned', () => HTTP_STATUS.CONFLICT)
    .with('invalid_input', () => HTTP_STATUS.BAD_REQUEST)
    .exhaustive()
