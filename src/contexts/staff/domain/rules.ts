// Staff context — domain rules
// Pure business rules for staff assignments.
// Per architecture: "Pure business rules. No async, no I/O, no throws." Validation returns Result.
//
// Authorization checks have been moved to the centralized permission system
// in shared/domain/permissions.ts (can() function). This file retains only
// pure validation rules.

import { ok, err } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import type { UserId } from '#/shared/domain/ids'
import type { StaffError } from './errors'
import { staffError } from './errors'

// ── Self-assignment guard ──────────────────────────────────────────

/** Prevent a user from assigning themselves to a property/team. */
export const validateNotSelfAssignment = (
  targetUserId: UserId,
  actingUserId: UserId,
): Result<true, StaffError> => {
  if (targetUserId === actingUserId) {
    return err(staffError('invalid_input', 'Cannot assign yourself to a property'))
  }
  return ok(true)
}

// ── Required ID validation ─────────────────────────────────────────

/** Validate that a required string ID is non-empty. */
export const validateRequiredId = (
  id: string,
  fieldName: string,
): Result<string, StaffError> => {
  const trimmed = id.trim()
  if (trimmed.length === 0) {
    return err(staffError('invalid_input', `${fieldName} is required`))
  }
  return ok(trimmed)
}
