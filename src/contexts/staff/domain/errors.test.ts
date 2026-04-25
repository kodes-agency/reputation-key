// Staff context — domain errors tests
// Per architecture: 100% coverage on errors, exhaustive code iteration.

import { describe, it, expect } from 'vitest'
import { staffError, isStaffError } from './errors'

describe('staffError', () => {
  it('creates a tagged error with _tag, code, and message', () => {
    const err = staffError('forbidden', 'no access')
    expect(err._tag).toBe('StaffError')
    expect(err.code).toBe('forbidden')
    expect(err.message).toBe('no access')
  })

  it('includes context when provided', () => {
    const err = staffError('already_assigned', 'duplicate', {
      userId: 'user-1',
      propertyId: 'prop-1',
    })
    expect(err.context).toEqual({ userId: 'user-1', propertyId: 'prop-1' })
  })

  it('omits context when not provided', () => {
    const err = staffError('forbidden', 'nope')
    expect(err.context).toBeUndefined()
  })

  it('every error code produces a valid error', () => {
    const codes = [
      'forbidden',
      'invalid_input',
      'assignment_not_found',
      'already_assigned',
      'property_not_found',
      'team_not_found',
    ] as const
    for (const code of codes) {
      const err = staffError(code, `test ${code}`)
      expect(err._tag).toBe('StaffError')
      expect(err.code).toBe(code)
      expect(err.message).toBe(`test ${code}`)
    }
  })
})

describe('isStaffError', () => {
  it('returns true for StaffError', () => {
    const err = staffError('forbidden', 'nope')
    expect(isStaffError(err)).toBe(true)
  })

  it('returns false for plain Error', () => {
    expect(isStaffError(new Error('nope'))).toBe(false)
  })

  it('returns false for null', () => {
    expect(isStaffError(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isStaffError(undefined)).toBe(false)
  })

  it('returns false for plain object with wrong _tag', () => {
    expect(isStaffError({ _tag: 'OtherError' })).toBe(false)
  })

  it('returns false for plain object without _tag', () => {
    expect(isStaffError({ code: 'forbidden', message: 'test' })).toBe(false)
  })
})
