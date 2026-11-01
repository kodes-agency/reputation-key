// Guest context — public server function gates.
//
// Source checks pin the public policy declarations; runtime tests below exercise
// the production handlers and resolver with request-boundary dependencies supplied.

import { beforeEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveLinkAndTrack } from '../application/use-cases/resolve-link-and-track'

import { selectGoogleReviewFn, selectSecondaryLinkFn } from './public'

// ── Server-fn gates (source-pinned) ───────────────────────────────
//
// Source assertions supplement the production-handler admission tests below.

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
    const assessment = fn.indexOf('initialIntegrityAssessment(')
    expect(resolve).toBeGreaterThan(-1)
    expect(limit).toBeGreaterThan(resolve)
    expect(persist).toBeGreaterThan(limit)
    expect(assessment).toBeGreaterThan(persist)
    expect(fn).toContain('if (trapped) return decoyView(data, getContainer().clock())')
    expect(source).toContain("reasonCode: 'honeypot_signal'")
    expect(source).toContain("outcome: 'filtered_automatically'")
    // The trap is checked before network volume, so it wins when both apply.
    const choice = source.slice(source.indexOf('const initialIntegrityAssessment ='))
    expect(choice.indexOf('flags.trapped')).toBeGreaterThan(-1)
    expect(choice.indexOf('HONEYPOT_INTEGRITY_ASSESSMENT')).toBeLessThan(
      choice.indexOf('NETWORK_VOLUME_INTEGRITY_ASSESSMENT'),
    )
  })

  it('keeps a new rating over the network budget, and only a new rating', () => {
    // Behaviour is in public-network-budget.test.ts; this pins who asks for it.
    expect(slice('submitGuestResponseFn')).toContain("'keep_over_network_volume'")
    for (const fnName of publicMutationServerFns.filter(
      (name) => name !== 'submitGuestResponseFn',
    )) {
      expect(slice(fnName), fnName).not.toContain('keep_over_network_volume')
    }
    expect(source).toContain("reasonCode: 'network_volume'")
    expect(source).toContain("actorId: 'guest-integrity-network-v1'")
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
    const ratingGate = fn.indexOf('if (!isQualifiedGuestResponse(response))')
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

  it('records secondary destinations through a session-bound mutation without requiring a rating', () => {
    const fn = slice('selectSecondaryLinkFn')
    expect(fn).not.toContain('responseLifecycle.getState')
    expect(fn).not.toContain('isQualifiedGuestResponse')
    expect(fn).toContain('response: false')
    expect(fn).toContain('analytics: true')
    expect(fn).toContain('resolveLinkAndTrack')
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

  // Manager moderation had a server function here and no screen. It hid a
  // guest's private note with no actor, no fact and no way back, and the
  // guest's own rating correction showed the note again. It is gone until a
  // moderation command exists that records who, commits its fact with the
  // change, and can be undone (Guest CONTEXT). Every function left in this
  // module is a guest's: none resolves a signed-in member.
  it('offers no manager moderation: nothing here acts for a signed-in member', () => {
    expect(source).not.toContain('moderateGuestResponseFn')
    expect(source).not.toContain('responseLifecycle.moderate')
    expect(source).not.toContain('resolveTenantContext')
    expect(source).not.toContain('requireExecutionAllowed')
    expect(source.match(/decidePublicExecution\(/gu)?.length).toBeGreaterThan(0)
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

  it('rotates shared-device recovery only after a durable rating or a withdrawal', () => {
    const fn = slice('startNewGuestResponseFn')
    const current = fn.indexOf('responseLifecycle.getState')
    const gate = fn.indexOf('if (!canStartNewGuestResponse(response))')
    const issue = fn.indexOf('guestSessions.issue')
    const cookie = fn.indexOf("setResponseHeader('Set-Cookie'")

    expect(current).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(current)
    expect(issue).toBeGreaterThan(gate)
    expect(cookie).toBeGreaterThan(issue)
    expect(fn).toContain("'new_response'")
    expect(fn).not.toContain('responseLifecycle.withdraw')
    expect(fn).not.toContain('responseLifecycle.correct')
    // Google still requires a rating; secondary links count from arrival.
    expect(fn).not.toContain('isQualifiedGuestResponse')
    expect(slice('selectGoogleReviewFn')).toContain(
      'if (!isQualifiedGuestResponse(response))',
    )
    expect(slice('selectSecondaryLinkFn')).not.toContain('isQualifiedGuestResponse')
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
    // A correction has no durable pressure: it would spend the venue's room for new ratings.
    expect(helper).not.toContain("correct: 'rating'")
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

const LINK_ID = '10000000-0000-4000-8000-000000000006'
const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001'
const PROPERTY_ID = '10000000-0000-4000-8000-000000000002'
const PORTAL_ID = '10000000-0000-4000-8000-000000000003'
const CSRF_NONCE = '10000000-0000-4000-8000-000000000004'
const SESSION_ID = '10000000-0000-4000-8000-000000000005'
const NOW = new Date('2026-10-22T09:00:00.000Z')
const RESET_AT = new Date('2026-10-22T09:10:00.000Z')
const ORIGIN = 'https://guest.example.test'
const PSEUDONYM = 'pseudonym-1'

const mocks = vi.hoisted(() => ({
  getPublicPortal: vi.fn(),
  verifySession: vi.fn(),
  verifyCsrf: vi.fn(),
  renewUntil: vi.fn(),
  hashNetworkPseudonym: vi.fn(),
  consumeGuestNetworkPressure: vi.fn(),
  reportObservationLoss: vi.fn(),
  reportNetworkBudgetExhausted: vi.fn(),
  rateLimiterCheck: vi.fn(),
  decidePublicExecution: vi.fn(),
  setResponseHeader: vi.fn(),
  submit: vi.fn(),
  correct: vi.fn(),
  getState: vi.fn(),
  trackReviewLinkClick: vi.fn(),
  logError: vi.fn(),
  headers: vi.fn(),
  trackSecondary: vi.fn(),
}))

// Outside a Start build `createServerFn` discards what the handler returns, so the
// seam runs the declared validator and then the handler, and hands back its answer.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate = (input: unknown): unknown => input
    const builder = {
      validator(next: typeof validate) {
        validate = next
        return builder
      },
      handler:
        (fn: (ctx: { data: unknown }) => Promise<unknown>) =>
        async (opts: { data: unknown }) =>
          fn({ data: validate(opts.data) }),
    }
    return builder
  },
}))
vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: mocks.setResponseHeader,
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: mocks.headers,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  decidePublicExecution: mocks.decidePublicExecution,
}))
vi.mock('#/shared/observability/logger', async (importOriginal) => {
  const logger = {
    child: () => logger,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mocks.logError,
  }
  return {
    ...(await importOriginal<typeof import('#/shared/observability/logger')>()),
    getLogger: () => logger,
  }
})
vi.mock('#/composition', () => ({
  getContainer: () => ({
    clock: () => NOW,
    rateLimiter: { check: mocks.rateLimiterCheck },
    guestPublicApi: {
      requests: {
        getPublicPortal: mocks.getPublicPortal,
        guestSessions: {
          verify: mocks.verifySession,
          verifyCsrf: mocks.verifyCsrf,
          renewUntil: mocks.renewUntil,
        },
        guestPublicRuntime: {
          expectedOrigin: ORIGIN,
          hashNetworkPseudonym: mocks.hashNetworkPseudonym,
        },
        consumeGuestNetworkPressure: mocks.consumeGuestNetworkPressure,
        reportObservationLoss: mocks.reportObservationLoss,
        reportNetworkBudgetExhausted: mocks.reportNetworkBudgetExhausted,
        trackReviewLinkClick: mocks.trackReviewLinkClick,
        resolveLinkAndTrack: resolveLinkAndTrack({
          publicPortalLookup: { findByToken: mocks.getPublicPortal },
          trackClick: mocks.trackSecondary,
          reportObservationLoss: mocks.reportObservationLoss,
        }),
        responseLifecycle: {
          submit: mocks.submit,
          correct: mocks.correct,
          getState: mocks.getState,
        },
      },
    },
  }),
}))

const PORTAL = {
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  portal: { id: PORTAL_ID },
  links: [{ id: LINK_ID, url: 'https://example.test/menu' }],
  responseConfiguration: {
    publicationState: 'published',
    publicationSnapshotId: 'snapshot-1',
    publicationVersion: 3,
    publicationDigest: 'digest-1',
    configurationDigest: 'configuration-1',
    guestLocale: 'en',
    languagePackVersion: 'guest-ui-en-v1',
    privateFeedbackThreshold: 3,
  },
  reviewGateway: { googleReview: { status: 'available', uri: 'https://g.page/r/venue' } },
}

const SESSION = { sessionId: SESSION_ID, expiresAt: new Date('2026-10-23T09:00:00.000Z') }
const WITHIN = {
  allowed: true,
  remaining: 10,
  resetAt: RESET_AT,
  backendStatus: 'available',
}
const EXHAUSTED = { ...WITHIN, allowed: false, remaining: 0 }
const SCOPE = {
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  portalId: PORTAL_ID,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.headers.mockResolvedValue(
    new Headers({ origin: ORIGIN, cookie: 'rk_guest=signed' }),
  )
  mocks.getPublicPortal.mockResolvedValue(PORTAL)
  mocks.verifySession.mockReturnValue(SESSION)
  mocks.verifyCsrf.mockImplementation((_session, nonce) => nonce === CSRF_NONCE)
  mocks.decidePublicExecution.mockResolvedValue({ allowed: true })
  mocks.hashNetworkPseudonym.mockReturnValue(PSEUDONYM)
  mocks.rateLimiterCheck.mockResolvedValue(WITHIN)
  mocks.consumeGuestNetworkPressure.mockResolvedValue(WITHIN)
  mocks.getState.mockResolvedValue(null)
})

const tap = (csrfNonce = CSRF_NONCE) =>
  selectSecondaryLinkFn({
    data: { token: 'pt_live', csrfNonce, linkId: LINK_ID },
  })

describe('secondary tap admission', () => {
  it('records a tap from a session that has not rated', async () => {
    await expect(tap()).resolves.toEqual({ url: 'https://example.test/menu' })
    expect(mocks.trackSecondary).toHaveBeenCalledExactlyOnceWith({
      ...SCOPE,
      linkId: LINK_ID,
      sessionId: SESSION_ID,
      sessionExpiresAt: SESSION.expiresAt,
      destinationKind: 'secondary_link',
    })
    expect(mocks.getState).not.toHaveBeenCalled()
    expect(mocks.decidePublicExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        consentAssertions: {
          analytics: true,
          response: false,
          freeText: false,
          contact: false,
          media: false,
        },
      }),
    )
  })

  it.each(['origin', 'csrf', 'session'] as const)(
    'refuses a wrong %s without enumeration',
    async (wrong) => {
      if (wrong === 'origin')
        mocks.headers.mockResolvedValue(new Headers({ origin: 'https://other.test' }))
      if (wrong === 'session') mocks.verifySession.mockReturnValue(null)
      await expect(tap(wrong === 'csrf' ? LINK_ID : CSRF_NONCE)).rejects.toMatchObject({
        status: 404,
        code: 'unavailable',
      })
      expect(mocks.trackSecondary).not.toHaveBeenCalled()
      expect(mocks.rateLimiterCheck).not.toHaveBeenCalled()
    },
  )

  it.each(['session', 'network', 'durable'] as const)(
    'returns the URL without recording when the %s budget is exhausted',
    async (layer) => {
      mocks.rateLimiterCheck.mockImplementation(async (key: string) =>
        key.includes(':network:')
          ? layer === 'network'
            ? EXHAUSTED
            : WITHIN
          : layer === 'session'
            ? EXHAUSTED
            : WITHIN,
      )
      if (layer === 'durable')
        mocks.consumeGuestNetworkPressure.mockResolvedValue(EXHAUSTED)
      await expect(tap()).resolves.toEqual({ url: 'https://example.test/menu' })
      expect(mocks.trackSecondary).not.toHaveBeenCalled()
    },
  )

  it('keeps scope equality when the link resolves after the session is bound', async () => {
    mocks.getPublicPortal
      .mockResolvedValueOnce(PORTAL)
      .mockResolvedValueOnce({ ...PORTAL, propertyId: LINK_ID })
    await expect(tap()).resolves.toEqual({ url: 'https://example.test/menu' })
    expect(mocks.trackSecondary).not.toHaveBeenCalled()
  })

  it('still refuses the Google action for an unrated session', async () => {
    await expect(
      selectGoogleReviewFn({ data: { token: 'pt_live', csrfNonce: CSRF_NONCE } }),
    ).rejects.toMatchObject({ status: 404, code: 'unavailable' })
    expect(mocks.trackReviewLinkClick).not.toHaveBeenCalled()
  })
})
