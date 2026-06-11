// Guest context — public server function tests
// Tests the error→status mapping and throwContextError construction used by
// the guest server functions. Since guestErrorStatus is private, we inline
// the same mapping logic and verify it against all known error codes.
//
// Per architecture: exhaustive ts-pattern matching ensures new error codes
// are caught at compile time.

import { describe, it, expect } from 'vitest'
import { match } from 'ts-pattern'
import { guestError } from '../domain/errors'
import type { GuestErrorCode } from '../domain/errors'
import { throwContextError } from '#/shared/auth/server-errors'
import { ratingInputSchema } from '../application/dto/rating.dto'
import { feedbackInputSchema } from '../application/dto/feedback.dto'

// ── Error → HTTP status mapping (mirrors production code) ─────────

const guestErrorStatus = (code: GuestErrorCode): number =>
  match(code)
    .with('rate_limit_exceeded', () => 429)
    .with(
      'invalid_rating',
      'duplicate_rating',
      'feedback_too_long',
      'feedback_empty',
      'invalid_source',
      'invalid_session',
      () => 400,
    )
    .with('portal_not_found', () => 404)
    .with('portal_inactive', () => 410)
    .with('forbidden', () => 403)
    .exhaustive()

describe('guestErrorStatus (mirrors server module)', () => {
  it('maps rate_limit_exceeded → 429', () => {
    expect(guestErrorStatus('rate_limit_exceeded')).toBe(429)
  })

  it('maps invalid_rating → 400', () => {
    expect(guestErrorStatus('invalid_rating')).toBe(400)
  })

  it('maps duplicate_rating → 400', () => {
    expect(guestErrorStatus('duplicate_rating')).toBe(400)
  })

  it('maps feedback_too_long → 400', () => {
    expect(guestErrorStatus('feedback_too_long')).toBe(400)
  })

  it('maps feedback_empty → 400', () => {
    expect(guestErrorStatus('feedback_empty')).toBe(400)
  })

  it('maps invalid_source → 400', () => {
    expect(guestErrorStatus('invalid_source')).toBe(400)
  })

  it('maps invalid_session → 400', () => {
    expect(guestErrorStatus('invalid_session')).toBe(400)
  })

  it('maps portal_not_found → 404', () => {
    expect(guestErrorStatus('portal_not_found')).toBe(404)
  })

  it('maps portal_inactive → 410', () => {
    expect(guestErrorStatus('portal_inactive')).toBe(410)
  })

  it('all error codes are covered (exhaustive check)', () => {
    const codes: GuestErrorCode[] = [
      'invalid_rating',
      'duplicate_rating',
      'feedback_too_long',
      'feedback_empty',
      'portal_not_found',
      'portal_inactive',
      'rate_limit_exceeded',
      'invalid_source',
      'invalid_session',
    ]
    for (const code of codes) {
      const status = guestErrorStatus(code)
      expect(status).toBeGreaterThanOrEqual(400)
      expect(status).toBeLessThan(500)
    }
  })
})

// ── throwContextError (shared server error helper) ─────────────────

describe('throwContextError with GuestError', () => {
  it('throws an Error with the domain message', () => {
    const e = guestError('invalid_rating', 'Rating must be between 1 and 5')
    expect(() => throwContextError('GuestError', e, guestErrorStatus(e.code))).toThrow(
      'Rating must be between 1 and 5',
    )
  })

  it('sets error.name to GuestError', () => {
    const e = guestError('portal_not_found', 'Portal missing')
    try {
      throwContextError('GuestError', e, guestErrorStatus(e.code))
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).name).toBe('GuestError')
    }
  })

  it('attaches code and status as custom properties', () => {
    const e = guestError('portal_inactive', 'Portal deactivated')
    try {
      throwContextError('GuestError', e, guestErrorStatus(e.code))
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.code).toBe('portal_inactive')
      expect(error.status).toBe(410)
    }
  })

  it('preserves the correct status for every error code', () => {
    const cases: Array<[GuestErrorCode, number]> = [
      ['rate_limit_exceeded', 429],
      ['invalid_rating', 400],
      ['duplicate_rating', 400],
      ['feedback_too_long', 400],
      ['feedback_empty', 400],
      ['invalid_source', 400],
      ['invalid_session', 400],
      ['portal_not_found', 404],
      ['portal_inactive', 410],
    ]
    for (const [code, expectedStatus] of cases) {
      const e = guestError(code, `test ${code}`)
      try {
        throwContextError('GuestError', e, guestErrorStatus(e.code))
      } catch (err) {
        const error = err as Error & { code: string; status: number }
        expect(error.status).toBe(expectedStatus)
        expect(error.code).toBe(code)
      }
    }
  })
})

// ── Rating input validation ───────────────────────────────────────

const validPortalId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

describe('ratingInputSchema', () => {
  it('accepts valid input with all fields', () => {
    const result = ratingInputSchema.safeParse({
      portalId: validPortalId,
      value: 5,
      source: 'qr',
    })
    expect(result.success).toBe(true)
  })

  it('accepts minimum valid input (source defaults to "direct")', () => {
    const result = ratingInputSchema.safeParse({
      portalId: validPortalId,
      value: 3,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.source).toBe('direct')
    }
  })

  it('accepts value 1 (minimum)', () => {
    const result = ratingInputSchema.safeParse({
      portalId: validPortalId,
      value: 1,
    })
    expect(result.success).toBe(true)
  })

  it('accepts value 5 (maximum)', () => {
    const result = ratingInputSchema.safeParse({
      portalId: validPortalId,
      value: 5,
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing portalId', () => {
    const result = ratingInputSchema.safeParse({
      value: 3,
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-UUID portalId', () => {
    const result = ratingInputSchema.safeParse({
      portalId: 'not-a-uuid',
      value: 3,
    })
    expect(result.success).toBe(false)
  })

  it('rejects value 0 (below minimum)', () => {
    const result = ratingInputSchema.safeParse({
      portalId: validPortalId,
      value: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects value 6 (above maximum)', () => {
    const result = ratingInputSchema.safeParse({
      portalId: validPortalId,
      value: 6,
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing value', () => {
    const result = ratingInputSchema.safeParse({
      portalId: validPortalId,
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid source', () => {
    const result = ratingInputSchema.safeParse({
      portalId: validPortalId,
      value: 3,
      source: 'email',
    })
    expect(result.success).toBe(false)
  })
})

// ── Feedback input validation ─────────────────────────────────────

describe('feedbackInputSchema', () => {
  it('accepts valid input with all fields', () => {
    const result = feedbackInputSchema.safeParse({
      portalId: validPortalId,
      comment: 'Great service!',
      ratingId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      source: 'qr',
      honeypot: '',
      submittedAt: Date.now(),
    })
    expect(result.success).toBe(true)
  })

  it('accepts minimum valid input (optional fields omitted)', () => {
    const result = feedbackInputSchema.safeParse({
      portalId: validPortalId,
      comment: 'Nice experience',
    })
    expect(result.success).toBe(true)
  })

  it('defaults source to "direct"', () => {
    const result = feedbackInputSchema.safeParse({
      portalId: validPortalId,
      comment: 'Good',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.source).toBe('direct')
    }
  })

  it('rejects missing portalId', () => {
    const result = feedbackInputSchema.safeParse({
      comment: 'Test',
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-UUID portalId', () => {
    const result = feedbackInputSchema.safeParse({
      portalId: 'not-a-uuid',
      comment: 'Test',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty comment', () => {
    const result = feedbackInputSchema.safeParse({
      portalId: validPortalId,
      comment: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing comment', () => {
    const result = feedbackInputSchema.safeParse({
      portalId: validPortalId,
    })
    expect(result.success).toBe(false)
  })

  it('rejects comment over 1000 characters', () => {
    const result = feedbackInputSchema.safeParse({
      portalId: validPortalId,
      comment: 'a'.repeat(1001),
    })
    expect(result.success).toBe(false)
  })

  it('accepts comment at exactly 1000 characters', () => {
    const result = feedbackInputSchema.safeParse({
      portalId: validPortalId,
      comment: 'a'.repeat(1000),
    })
    expect(result.success).toBe(true)
  })
})
