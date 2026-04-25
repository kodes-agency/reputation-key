// Identity context — server function tests
// Imports the real identityErrorToResponse from the server module so tests break
// when production code changes.
//
// Per architecture: "Server functions: Integration tests covering HTTP behavior —
// status codes, response shapes, middleware enforcement."
// Per architecture: exhaustive ts-pattern matching ensures new error codes
// are caught at compile time.

import { describe, it, expect } from 'vitest'
import { identityError, isIdentityError } from '#/contexts/identity/domain/errors'
import type { IdentityErrorCode } from '#/contexts/identity/domain/errors'
import { identityErrorToResponse } from '#/contexts/identity/server/organizations'

// ── Tests ────────────────────────────────────────────────────────────

describe('identityErrorToResponse (imported from server module)', () => {
  it('maps forbidden → 403', () => {
    const error = identityError('forbidden', 'Insufficient role')
    const { status, body } = identityErrorToResponse(error)
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
    expect(body.message).toBe('Insufficient role')
  })

  it('maps invalid_slug → 400', () => {
    const error = identityError('invalid_slug', 'Bad slug')
    const { status, body } = identityErrorToResponse(error)
    expect(status).toBe(400)
    expect(body.error).toBe('invalid_slug')
  })

  it('maps invalid_name → 400', () => {
    const error = identityError('invalid_name', 'Bad name')
    const { status, body } = identityErrorToResponse(error)
    expect(status).toBe(400)
    expect(body.error).toBe('invalid_name')
  })

  it('maps registration_failed → 400', () => {
    const error = identityError('registration_failed', 'Sign-up failed')
    const { status, body } = identityErrorToResponse(error)
    expect(status).toBe(400)
    expect(body.error).toBe('registration_failed')
  })

  it('maps org_setup_failed → 409', () => {
    const error = identityError('org_setup_failed', 'Slug conflict')
    const { status, body } = identityErrorToResponse(error)
    expect(status).toBe(409)
    expect(body.error).toBe('org_setup_failed')
  })

  it('maps member_not_found → 404', () => {
    const error = identityError('member_not_found', 'Member not found')
    const { status, body } = identityErrorToResponse(error)
    expect(status).toBe(404)
    expect(body.error).toBe('member_not_found')
  })

  it('maps invitation_not_found → 404', () => {
    const error = identityError('invitation_not_found', 'Invitation not found')
    const { status, body } = identityErrorToResponse(error)
    expect(status).toBe(404)
    expect(body.error).toBe('invitation_not_found')
  })

  it('exhaustive matching catches all error codes', () => {
    // The .exhaustive() call in the production function provides compile-time safety.
    // This test verifies every code maps to a valid HTTP error status.
    const allCodes: IdentityErrorCode[] = [
      'forbidden',
      'invalid_slug',
      'invalid_name',
      'member_not_found',
      'invitation_not_found',
      'registration_failed',
      'org_setup_failed',
    ]

    for (const code of allCodes) {
      const error = identityError(code, 'test')
      const result = identityErrorToResponse(error)
      // org_setup_failed intentionally returns 409 (user was created, org failed)
      if (code === 'org_setup_failed') {
        expect(result.status).toBe(409)
      } else {
        expect(result.status).toBeGreaterThanOrEqual(400)
      }
      expect(result.body.error).toBe(code)
    }
  })
})

describe('server function response shape', () => {
  it('formats error responses as JSON with error and message fields', () => {
    const error = identityError('forbidden', 'Insufficient role')
    const { status, body } = identityErrorToResponse(error)

    // Simulating what throwIdentityError does:
    const response = new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(403)
    expect(response.headers.get('content-type')).toBe('application/json')
  })
})

describe('isIdentityError type guard (server catch path)', () => {
  it('recognizes IdentityError objects', () => {
    const error = identityError('forbidden', 'test')
    expect(isIdentityError(error)).toBe(true)
  })

  it('rejects plain Error objects', () => {
    const error = new Error('plain error')
    expect(isIdentityError(error)).toBe(false)
  })

  it('rejects null', () => {
    expect(isIdentityError(null)).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isIdentityError(undefined)).toBe(false)
  })
})
