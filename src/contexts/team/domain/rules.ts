// Team context — domain rules
// Pure business rules. No async, no I/O, no throws. Validation returns Result.
//
// Authorization checks have been moved to the centralized permission system
// in shared/domain/permissions.ts (can() function). This file retains only
// pure validation rules.

import { ok, err } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import type { TeamError } from './errors'
import { teamError } from './errors'

// ── Name validation ────────────────────────────────────────────────

/** Validate a team name. */
export const validateTeamName = (name: string): Result<string, TeamError> => {
  const trimmed = name.trim()
  if (trimmed.length < 1) {
    return err(teamError('invalid_name', 'Team name is required'))
  }
  if (trimmed.length > 100) {
    return err(teamError('invalid_name', 'Team name must be at most 100 characters'))
  }
  return ok(trimmed)
}
