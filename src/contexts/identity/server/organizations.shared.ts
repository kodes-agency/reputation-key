// Shared types, helpers, and error mapping for organization server functions.
// Extracted from organizations.ts to keep each file ≤150 lines.

import { HTTP_STATUS } from '#/shared/http/status'
import { match } from 'ts-pattern'
import type { CommandErrors } from '#/shared/commands/contracts'
import {
  isIdentityError,
  type IdentityError,
  type IdentityErrorCode,
} from '../domain/errors'

// ── Error → HTTP translation ──────────────────────────────────────
// Per architecture: "ts-pattern with .exhaustive() ensures new error codes
// force a compiler error here."

export const identityErrorStatus = (code: IdentityErrorCode): number =>
  match(code)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with(
      'invalid_slug',
      'invalid_name',
      'validation_error',
      'feedback_triage_invalid',
      () => HTTP_STATUS.BAD_REQUEST,
    )
    .with('registration_failed', () => HTTP_STATUS.BAD_REQUEST)
    .with(
      'org_setup_failed',
      'already_exists',
      'organization_conflict',
      'last_owner',
      'invitation_expired',
      'account_exists',
      () => HTTP_STATUS.CONFLICT,
    )
    .with('member_not_found', 'invitation_not_found', () => HTTP_STATUS.NOT_FOUND)
    .exhaustive()

/** The error map every Identity `command()` handler shares. */
export const identityCommandErrors = {
  name: 'IdentityError',
  is: isIdentityError,
  status: identityErrorStatus,
} satisfies CommandErrors<IdentityError>
