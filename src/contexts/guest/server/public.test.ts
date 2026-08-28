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
  const responseDtoSource = readFileSync(
    new URL('../application/dto/guest-response-form.dto.ts', import.meta.url),
    'utf8',
  )
  const publicMutationServerFns = [
    'submitGuestResponseFn',
    'correctGuestResponseFn',
    'startNewGuestResponseFn',
    'submitPrivateFeedbackFn',
    'withdrawPrivateFeedbackFn',
    'selectGoogleReviewFn',
    'selectSecondaryLinkFn',
    'withdrawGuestResponseFn',
    'moderateGuestResponseFn',
  ] as const
  const slice = (fnName: string): string => {
    const start = source.indexOf(`export const ${fnName} =`)
    expect(start).toBeGreaterThan(-1)
    const next = source.indexOf('\nexport const ', start + 1)
    return source.slice(start, next === -1 ? source.length : next)
  }

  it('applies the private response policy before every mutation can return', () => {
    expect(
      [...source.matchAll(/export const (\w+) = createServerFn/gu)].map(
        ([, name]) => name,
      ),
    ).toEqual(publicMutationServerFns)

    for (const fnName of publicMutationServerFns) {
      const fn = slice(fnName)
      expect(fn, fnName).toContain('.validator(guestPublicResponseValidator(')
      const privacy = fn.indexOf('applyGuestPublicResponsePrivacy()')
      const firstAwait = fn.indexOf('await ')
      const firstReturn = fn.indexOf('return ')
      expect(privacy, fnName).toBeGreaterThan(-1)
      if (firstAwait >= 0) expect(privacy, fnName).toBeLessThan(firstAwait)
      if (firstReturn >= 0) expect(privacy, fnName).toBeLessThan(firstReturn)
    }
  })

  it('covers scan/read/link paths and varies only cookie-bound responses', () => {
    const scans = readFileSync(new URL('./guest-scans.ts', import.meta.url), 'utf8')
    const scanSlice = (fnName: string): string => {
      const start = scans.indexOf(`export const ${fnName} =`)
      const next = scans.indexOf('\nexport const ', start + 1)
      return scans.slice(start, next === -1 ? scans.length : next)
    }

    expect(
      [...scans.matchAll(/export const (\w+) = createServerFn/gu)].map(
        ([, name]) => name,
      ),
    ).toEqual(['recordScanFn', 'getPublicPortal', 'resolvePublicPortalLink'])

    expect(scanSlice('recordScanFn')).toContain('applyGuestPublicResponsePrivacy()')
    expect(scanSlice('recordScanFn')).toContain(
      '.validator(guestPublicResponseValidator(',
    )
    expect(scanSlice('getPublicPortal')).toContain('applyGuestPublicResponsePrivacy()')
    expect(scanSlice('getPublicPortal')).toContain(
      '.validator(guestPublicResponseValidator(',
    )
    expect(scanSlice('resolvePublicPortalLink')).toContain(
      'applyGuestPublicResponsePrivacy({ varyCookie: false })',
    )
    expect(scanSlice('resolvePublicPortalLink')).toContain(
      'guestPublicResponseValidator(resolveLinkSchema, { varyCookie: false })',
    )
  })

  it('rate-limits the terminal public response withdrawal after session binding', () => {
    const fn = slice('withdrawGuestResponseFn')
    const binding = fn.indexOf('resolveBoundSession')
    const limit = fn.indexOf("'response_withdraw'")
    const mutation = fn.indexOf('responseLifecycle.withdraw')

    expect(binding).toBeGreaterThan(-1)
    expect(limit).toBeGreaterThan(binding)
    expect(mutation).toBeGreaterThan(limit)
  })

  it('declares the honeypot on the mutation schema, so the field is not stripped', () => {
    // zod strips unknown keys silently: without this member the form's trap
    // input never reaches the handler and the trap is inert.
    expect(responseDtoSource).toContain('honeypot: z.string().max(256).optional()')
    expect(source).toContain('guestPublicResponseValidator(guestRatingMutationDto)')
    expect(source).toContain(
      'guestPublicResponseValidator(guestPrivateFeedbackMutationDto)',
    )
  })

  it('binds and rate-limits a filled submit honeypot before automatic filtering', () => {
    const fn = slice('submitGuestResponseFn')
    const resolve = fn.indexOf('resolveBoundSession')
    const limit = fn.indexOf("'submit',")
    const persist = fn.indexOf('responseLifecycle.submit')
    const assessment = fn.indexOf('HONEYPOT_INTEGRITY_ASSESSMENT')
    expect(resolve).toBeGreaterThan(-1)
    expect(limit).toBeGreaterThan(resolve)
    expect(persist).toBeGreaterThan(limit)
    expect(assessment).toBeGreaterThan(persist)
    expect(fn).toContain('if (trapped) return decoyView(data, getContainer().clock())')
    expect(source).toContain("reasonCode: 'honeypot_signal'")
    expect(source).toContain("outcome: 'filtered_automatically'")
  })

  it('answers a filled honeypot before correct resolves a session or writes', () => {
    const fn = slice('correctGuestResponseFn')
    const trap = fn.indexOf(
      'if (data.honeypot) return decoyView(data, getContainer().clock())',
    )
    expect(trap).toBeGreaterThan(-1)
    expect(trap).toBeLessThan(fn.indexOf('resolveBoundSession'))
    expect(trap).toBeLessThan(fn.indexOf('responseLifecycle.correct'))
  })

  it('keeps private feedback as a separate post-rating command', () => {
    const ratingSchema = responseDtoSource.slice(
      responseDtoSource.indexOf('export const guestRatingMutationDto'),
      responseDtoSource.indexOf('export const guestPrivateFeedbackMutationDto'),
    )
    expect(ratingSchema).toContain('rating: z.number().int().min(1).max(5)')
    expect(ratingSchema).not.toContain('text:')

    const feedback = slice('submitPrivateFeedbackFn')
    expect(feedback).toContain("capability: 'portal.guest_text'")
    expect(feedback).toContain('responseLifecycle.addPrivateFeedback')
  })

  it('binds rating submission to the server-resolved Portal experience', () => {
    const fn = slice('submitGuestResponseFn')
    expect(fn).toContain('bound.portal.responseConfiguration.publicationState')
    expect(fn).toContain('bound.portal.responseConfiguration.configurationDigest')
    expect(fn).toContain('bound.portal.responseConfiguration.guestLocale')
    expect(fn).toContain('bound.portal.responseConfiguration.languagePackVersion')
    expect(fn).toContain('bound.portal.responseConfiguration.privateFeedbackThreshold')
  })

  it('renews recovery only to each committed withdrawal deadline', () => {
    const rating = slice('submitGuestResponseFn')
    expect(rating).toContain('response.responseWithdrawalDeadline')
    expect(rating).toContain('guestSessions.renewUntil')
    expect(rating).toContain("setResponseHeader('Set-Cookie'")

    const feedback = slice('submitPrivateFeedbackFn')
    expect(feedback).toContain('response.feedbackWithdrawalDeadline')
    expect(feedback).toContain('guestSessions.renewUntil')
    expect(feedback).toContain("setResponseHeader('Set-Cookie'")
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
    expect(fn).toContain('if (qualified)')
    expect(fn).toContain('true,')
    expect(fn).toContain('sessionExpiresAt: bound.session.expiresAt')
    expect(fn).toContain('bound.portal.reviewGateway.googleReview')
    expect(fn).toContain("googleReview.status !== 'available'")
    expect(fn).toContain('return { url: googleReview.uri }')
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

  it('uses the same canonical pressure authority for scan attempts without copying it into scan facts', () => {
    const scans = readFileSync(new URL('./guest-scans.ts', import.meta.url), 'utf8')
    const start = scans.indexOf('export const recordScanFn =')
    const end = scans.indexOf('// ── getPublicPortal', start)
    const fn = scans.slice(start, end)
    expect(fn).toContain('checkLayeredGuestRateLimit')
    expect(fn).toContain('consumeGuestNetworkPressure')
    expect(fn).toContain("action: 'qualified_scan'")
    expect(fn).toContain('guestPublicRuntime.hashNetworkPseudonym')
    expect(fn).not.toContain('ipHash,')
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
      'startNewGuestResponseFn',
      'withdrawGuestResponseFn',
    ]) {
      expect(slice(fnName)).toContain("capability: 'portal.guest_response'")
    }
  })

  it('rotates shared-device recovery only after a durable rating', () => {
    const fn = slice('startNewGuestResponseFn')
    const current = fn.indexOf('responseLifecycle.getState')
    const ratingGate = fn.indexOf('if (!response?.rating')
    const issue = fn.indexOf('guestSessions.issue')
    const cookie = fn.indexOf("setResponseHeader('Set-Cookie'")

    expect(current).toBeGreaterThan(-1)
    expect(ratingGate).toBeGreaterThan(current)
    expect(issue).toBeGreaterThan(ratingGate)
    expect(cookie).toBeGreaterThan(issue)
    expect(fn).toContain("'new_response'")
    expect(fn).not.toContain('responseLifecycle.withdraw')
    expect(fn).not.toContain('responseLifecycle.correct')
  })

  it('keeps action-specific network limits on distinct Redis keys', () => {
    expect(source).toContain('portal:${portalId}:${action}`')
  })

  it('adds the canonical durable pressure authority without replacing signed-session limits', () => {
    const helper = source.slice(
      source.indexOf('async function rateLimit('),
      source.indexOf('function assertions('),
    )
    expect(helper).toContain('guestRateLimitKey')
    expect(helper).toContain('rateLimiter.check')
    expect(helper).toContain('consumeGuestNetworkPressure')
    expect(helper).toContain("submit: 'rating'")
    expect(helper).toContain("correct: 'rating'")
    expect(helper).toContain("feedback: 'private_feedback'")
    expect(helper).toContain("google: 'destination_action'")
    expect(helper).toContain("secondary: 'destination_action'")
    expect(helper).not.toContain("feedback_withdraw: 'private_feedback'")
    expect(helper).not.toContain("new_response: 'rating'")
  })

  it('reports only true fail-open destination and scan observation loss', () => {
    const helper = source.slice(
      source.indexOf('async function rateLimit('),
      source.indexOf('function assertions('),
    )
    expect(helper).toContain("reportObservationLoss('review_link')")
    expect(helper).toContain("backendStatus === 'unavailable'")
    expect(helper.indexOf("reportObservationLoss('review_link')")).toBeGreaterThan(
      helper.indexOf('if (failOpenNavigation)'),
    )
    expect(helper).not.toContain("reportObservationLoss('rating')")

    const scans = readFileSync(new URL('./guest-scans.ts', import.meta.url), 'utf8')
    const start = scans.indexOf('export const recordScanFn =')
    const end = scans.indexOf('// ── getPublicPortal', start)
    const scanFn = scans.slice(start, end)
    expect(scanFn).toContain("reportObservationLoss('scan')")
    expect(scanFn).toContain("backendStatus === 'unavailable'")
    expect(scanFn).not.toContain("reportObservationLoss('rating')")
  })

  it('keeps portal.guest_text on private-feedback submit and withdrawal', () => {
    for (const fnName of ['submitPrivateFeedbackFn', 'withdrawPrivateFeedbackFn']) {
      expect(slice(fnName)).toContain("capability: 'portal.guest_text'")
    }
    expect(slice('submitPrivateFeedbackFn')).toContain("'feedback',")
    expect(slice('withdrawPrivateFeedbackFn')).toContain("'feedback_withdraw',")
  })
})
