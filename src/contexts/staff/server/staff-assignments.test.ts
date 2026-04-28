// Staff context — server function tests
// Verifies staff error → HTTP status mapping and tagged error detection.
// Follows the same pattern as organizations.test.ts and teams.test.ts.

import { describe, it, expect } from 'vitest'
import { staffError, isStaffError } from '#/contexts/staff/domain/errors'
import type { StaffErrorCode } from '#/contexts/staff/domain/errors'
import { throwContextError } from '#/shared/auth/server-errors'

const staffErrorStatus = (code: StaffErrorCode): number => {
  switch (code) {
    case 'forbidden':
      return 403
    case 'assignment_not_found':
      return 404
    case 'property_not_found':
      return 404
    case 'team_not_found':
      return 404
    case 'already_assigned':
      return 409
    case 'invalid_input':
      return 400
  }
}

describe('staffErrorStatus (error → HTTP status mapping)', () => {
  it('maps forbidden → 403', () => {
    expect(staffErrorStatus('forbidden')).toBe(403)
  })

  it('maps assignment_not_found → 404', () => {
    expect(staffErrorStatus('assignment_not_found')).toBe(404)
  })

  it('maps property_not_found → 404', () => {
    expect(staffErrorStatus('property_not_found')).toBe(404)
  })

  it('maps team_not_found → 404', () => {
    expect(staffErrorStatus('team_not_found')).toBe(404)
  })

  it('maps already_assigned → 409', () => {
    expect(staffErrorStatus('already_assigned')).toBe(409)
  })

  it('maps invalid_input → 400', () => {
    expect(staffErrorStatus('invalid_input')).toBe(400)
  })
})

describe('isStaffError type guard', () => {
  it('returns true for staff errors', () => {
    const err = staffError('forbidden', 'no access')
    expect(isStaffError(err)).toBe(true)
  })

  it('returns false for plain Error', () => {
    expect(isStaffError(new Error('something'))).toBe(false)
  })

  it('returns false for null', () => {
    expect(isStaffError(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isStaffError(undefined)).toBe(false)
  })

  it('returns false for string', () => {
    expect(isStaffError('error')).toBe(false)
  })

  it('returns false for object without _tag', () => {
    expect(isStaffError({ code: 'forbidden', message: 'no' })).toBe(false)
  })

  it('returns false for object with wrong _tag', () => {
    expect(isStaffError({ _tag: 'TeamError', code: 'forbidden', message: 'no' })).toBe(
      false,
    )
  })
})

describe('staffError smart constructor', () => {
  it('creates error with correct _tag and code', () => {
    const err = staffError('already_assigned', 'user already assigned')
    expect(err._tag).toBe('StaffError')
    expect(err.code).toBe('already_assigned')
    expect(err.message).toBe('user already assigned')
  })

  it('includes context when provided', () => {
    const err = staffError('assignment_not_found', 'not found', { assignmentId: 'a-1' })
    expect(err.context).toEqual({ assignmentId: 'a-1' })
  })

  it('omits context when not provided', () => {
    const err = staffError('forbidden', 'denied')
    expect(err.context).toBeUndefined()
  })
})

describe('throwContextError integration', () => {
  it('throws Error with correct name, code, and status for StaffError', () => {
    const err = staffError('forbidden', 'Access denied')

    expect(() =>
      throwContextError('StaffError', err, staffErrorStatus(err.code)),
    ).toThrow(
      expect.objectContaining({
        message: 'Access denied',
      }),
    )
  })

  it('thrown error has code and status properties', () => {
    const err = staffError('already_assigned', 'Duplicate assignment')

    try {
      throwContextError('StaffError', err, staffErrorStatus(err.code))
    } catch (e) {
      expect((e as Error).name).toBe('StaffError')
      expect((e as unknown as Record<string, unknown>).code).toBe('already_assigned')
      expect((e as unknown as Record<string, unknown>).status).toBe(409)
    }
  })

  it('thrown error maps assignment_not_found to 404', () => {
    const err = staffError('assignment_not_found', 'Not found')

    try {
      throwContextError('StaffError', err, staffErrorStatus(err.code))
    } catch (e) {
      expect((e as unknown as Record<string, unknown>).status).toBe(404)
    }
  })

  it('thrown error maps invalid_input to 400', () => {
    const err = staffError('invalid_input', 'Bad data')

    try {
      throwContextError('StaffError', err, staffErrorStatus(err.code))
    } catch (e) {
      expect((e as unknown as Record<string, unknown>).status).toBe(400)
    }
  })
})
