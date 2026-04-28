// Identity context — server function tests
// Imports the real identityErrorStatus from the server module so tests break
// when production code changes.
//
// Per architecture: "Server functions throw Error objects with .name, .message, .code, .status."
// Per architecture: exhaustive ts-pattern matching ensures new error codes
// are caught at compile time.

import { describe, it, expect } from 'vitest'
import { identityError, isIdentityError } from '#/contexts/identity/domain/errors'
import type { IdentityErrorCode } from '#/contexts/identity/domain/errors'
import { identityErrorStatus } from '#/contexts/identity/server/organizations'
import { throwContextError } from '#/shared/auth/server-errors'

// ── Error → HTTP status mapping (production code) ─────────────────

describe('identityErrorStatus (imported from server module)', () => {
  it('maps forbidden → 403', () => {
    expect(identityErrorStatus('forbidden')).toBe(403)
  })

  it('maps invalid_slug → 400', () => {
    expect(identityErrorStatus('invalid_slug')).toBe(400)
  })

  it('maps invalid_name → 400', () => {
    expect(identityErrorStatus('invalid_name')).toBe(400)
  })

  it('maps registration_failed → 400', () => {
    expect(identityErrorStatus('registration_failed')).toBe(400)
  })

  it('maps org_setup_failed → 409', () => {
    expect(identityErrorStatus('org_setup_failed')).toBe(409)
  })

  it('maps member_not_found → 404', () => {
    expect(identityErrorStatus('member_not_found')).toBe(404)
  })

  it('maps invitation_not_found → 404', () => {
    expect(identityErrorStatus('invitation_not_found')).toBe(404)
  })

  it('all error codes are covered (exhaustive check)', () => {
    const codes: IdentityErrorCode[] = [
      'forbidden',
      'invalid_slug',
      'invalid_name',
      'member_not_found',
      'invitation_not_found',
      'registration_failed',
      'org_setup_failed',
    ]
    for (const code of codes) {
      const status = identityErrorStatus(code)
      expect(status).toBeGreaterThanOrEqual(400)
      expect(status).toBeLessThan(500)
    }
  })
})

// ── throwContextError (shared server error helper) ─────────────────

describe('throwContextError with IdentityError', () => {
  it('throws an Error with the domain message', () => {
    const e = identityError('forbidden', 'Insufficient role')
    expect(() =>
      throwContextError('IdentityError', e, identityErrorStatus(e.code)),
    ).toThrow('Insufficient role')
  })

  it('sets error.name to IdentityError', () => {
    const e = identityError('forbidden', 'Insufficient role')
    try {
      throwContextError('IdentityError', e, identityErrorStatus(e.code))
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).name).toBe('IdentityError')
    }
  })

  it('attaches code and status as custom properties', () => {
    const e = identityError('org_setup_failed', 'Slug conflict')
    try {
      throwContextError('IdentityError', e, identityErrorStatus(e.code))
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.code).toBe('org_setup_failed')
      expect(error.status).toBe(409)
    }
  })

  it('preserves the correct status for every error code', () => {
    const cases: Array<[IdentityErrorCode, number]> = [
      ['forbidden', 403],
      ['invalid_slug', 400],
      ['invalid_name', 400],
      ['registration_failed', 400],
      ['org_setup_failed', 409],
      ['member_not_found', 404],
      ['invitation_not_found', 404],
    ]
    for (const [code, expectedStatus] of cases) {
      const e = identityError(code, `test ${code}`)
      try {
        throwContextError('IdentityError', e, identityErrorStatus(e.code))
      } catch (err) {
        const error = err as Error & { code: string; status: number }
        expect(error.status).toBe(expectedStatus)
        expect(error.code).toBe(code)
      }
    }
  })
})

// ── isIdentityError type guard ─────────────────────────────────────

describe('isIdentityError type guard', () => {
  it('returns true for IdentityError', () => {
    const error = identityError('forbidden', 'test')
    expect(isIdentityError(error)).toBe(true)
  })

  it('returns false for plain Error', () => {
    expect(isIdentityError(new Error('boom'))).toBe(false)
  })

  it('returns false for null', () => {
    expect(isIdentityError(null)).toBe(false)
  })

  it('returns false for plain object', () => {
    expect(isIdentityError({ code: 'forbidden', message: 'test' })).toBe(false)
  })
})
