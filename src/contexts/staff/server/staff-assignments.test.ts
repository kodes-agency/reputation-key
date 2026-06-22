// Staff context — server function tests
// Verifies staff error → HTTP status mapping and tagged error detection.
// Follows the same pattern as organizations.test.ts and teams.test.ts.

import { describe, it, expect } from 'vitest'
import { staffError } from '#/contexts/staff/domain/errors'
import { throwContextError } from '#/shared/auth/server-errors'
import { staffErrorStatus } from './staff-shared'

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
