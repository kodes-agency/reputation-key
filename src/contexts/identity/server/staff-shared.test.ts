// Identity People — the HTTP status each Staff error code answers with.
//
// staffErrorStatus matches exhaustively, so a missing code fails to compile.
// A wrong status does not: nothing else names this mapper, and the server
// function tests beside it stop at the execution policy. The table below is
// typed by the code union, so a new code must be given its status here too.

import { describe, expect, it } from 'vitest'
import type { StaffErrorCode } from '../domain/people-errors'
import { staffErrorStatus } from './staff-shared'

const STATUS_BY_CODE: Readonly<Record<StaffErrorCode, number>> = {
  forbidden: 403,
  invalid_input: 400,
  participation_not_found: 404,
  property_not_found: 404,
  participation_archived: 409,
  responsibility_conflict: 409,
  revision_conflict: 409,
}

describe('staffErrorStatus', () => {
  it.each(Object.entries(STATUS_BY_CODE) as ReadonlyArray<[StaffErrorCode, number]>)(
    'answers %s with %i',
    (code, status) => {
      expect(staffErrorStatus(code)).toBe(status)
    },
  )
})
