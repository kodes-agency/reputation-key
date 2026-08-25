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
import { readFileSync } from 'node:fs'

// ── Error → HTTP status mapping (mirrors production code) ─────────

const guestErrorStatus = (code: GuestErrorCode): number =>
  match(code)
    .with('rate_limit_exceeded', () => 429)
    .with(
      'invalid_rating',
      'duplicate_rating',
      'duplicate_feedback',
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
      'duplicate_feedback',
      'feedback_too_long',
      'feedback_empty',
      'portal_not_found',
      'portal_inactive',
      'rate_limit_exceeded',
      'invalid_source',
      'invalid_session',
      'forbidden',
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

// ── Server-fn gates (source-pinned) ───────────────────────────────
//
// public.ts imports the composition root, so it cannot be imported here; the
// catalogue guard (entry-point-catalogue.test.ts) verifies the row ↔ code
// capability match and these pin the invariants that guard alone cannot see.

describe('guest response server-fn gates', () => {
  const source = readFileSync(new URL('./public.ts', import.meta.url), 'utf8')
  const slice = (fnName: string): string => {
    const start = source.indexOf(`export const ${fnName} =`)
    expect(start).toBeGreaterThan(-1)
    const next = source.indexOf('\nexport const ', start + 1)
    return source.slice(start, next === -1 ? source.length : next)
  }

  it('declares the honeypot on the mutation schema, so the field is not stripped', () => {
    // zod strips unknown keys silently: without this member the form's trap
    // input never reaches the handler and the trap is inert.
    expect(source).toContain('honeypot: z.string().max(256).optional()')
  })

  it('answers a filled honeypot before submit resolves a session or writes', () => {
    const fn = slice('submitGuestResponseFn')
    const trap = fn.indexOf('if (data.honeypot) return decoyView(data)')
    expect(trap).toBeGreaterThan(-1)
    expect(trap).toBeLessThan(fn.indexOf('resolveBoundSession'))
    expect(trap).toBeLessThan(fn.indexOf('responseLifecycle.submit'))
  })

  it('answers a filled honeypot before correct resolves a session or writes', () => {
    const fn = slice('correctGuestResponseFn')
    const trap = fn.indexOf('if (data.honeypot) return decoyView(data)')
    expect(trap).toBeGreaterThan(-1)
    expect(trap).toBeLessThan(fn.indexOf('resolveBoundSession'))
    expect(trap).toBeLessThan(fn.indexOf('responseLifecycle.correct'))
  })

  it('keeps private feedback as a separate post-rating command', () => {
    const ratingSchema = source.slice(
      source.indexOf('const ratingMutationSchema'),
      source.indexOf('const privateFeedbackMutationSchema'),
    )
    expect(ratingSchema).toContain('rating: z.number().int().min(1).max(5)')
    expect(ratingSchema).not.toContain('text:')

    const feedback = slice('submitPrivateFeedbackFn')
    expect(feedback).toContain("capability: 'portal.guest_text'")
    expect(feedback).toContain('responseLifecycle.addPrivateFeedback')
  })

  it('reveals the Google action only after this signed session has a rating', () => {
    const fn = slice('selectGoogleReviewFn')
    const receipt = fn.indexOf('responseLifecycle.getState')
    const ratingGate = fn.indexOf('if (!response?.rating')
    const metric = fn.indexOf('trackReviewLinkClick')
    expect(receipt).toBeGreaterThan(-1)
    expect(ratingGate).toBeGreaterThan(receipt)
    expect(metric).toBeGreaterThan(ratingGate)
    expect(fn).toContain("destinationKind: 'google_review'")
    expect(fn).toContain('sessionExpiresAt: bound.session.expiresAt')
    expect(fn).toContain('bound.portal.reviewGateway.googleReviewUri')
  })

  it('records secondary destinations only through a rated explicit mutation', () => {
    const fn = slice('selectSecondaryLinkFn')
    const receipt = fn.indexOf('responseLifecycle.getState')
    const ratingGate = fn.indexOf('if (!response?.rating')
    const selection = fn.indexOf('resolveLinkAndTrack')
    expect(receipt).toBeGreaterThan(-1)
    expect(ratingGate).toBeGreaterThan(receipt)
    expect(selection).toBeGreaterThan(ratingGate)
    expect(fn).toContain("action: 'public:portal.secondary_link.select'")
    expect(fn).toContain('sessionExpiresAt: bound.session.expiresAt')
  })

  it('keeps the public GET redirect navigation-only', () => {
    const scans = readFileSync(new URL('./guest-scans.ts', import.meta.url), 'utf8')
    const start = scans.indexOf('export const resolvePublicPortalLink =')
    expect(start).toBeGreaterThan(-1)
    const fn = scans.slice(start)
    expect(fn).toContain('useCases.resolveLinkAndTrack')
    expect(fn).not.toContain('qualifyObservation')
    expect(fn).not.toContain('trackReviewLinkClick')
  })

  it('gates staff moderation on portal.write, not the guest collection capability', () => {
    const fn = slice('moderateGuestResponseFn')
    expect(fn).toContain("capability: 'portal.write'")
    expect(fn).not.toContain("capability: 'portal.guest_response'")
  })

  it('keeps portal.guest_response on the public-facing paths', () => {
    for (const fnName of [
      'submitGuestResponseFn',
      'correctGuestResponseFn',
      'withdrawGuestResponseFn',
    ]) {
      expect(slice(fnName)).toContain("capability: 'portal.guest_response'")
    }
  })
})
