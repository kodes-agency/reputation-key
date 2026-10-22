// Guest context — what a guest on a venue's shared Wi-Fi is answered.
//
// Runtime-imports the production handlers, with their own validators and the real
// `tracedHandler` around them, as guest-scans.test.ts does for the scan beacon. A
// hotel, a restaurant or a salon is one public address for every guest in the
// room, so a new rating is never refused for network volume: past the network
// layer it is kept, filtered automatically, and the guest gets the normal view.

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  headersFromContext: vi.fn(
    async () =>
      new Headers({
        cookie: 'rk_guest=signed',
        origin: ORIGIN,
        'x-real-ip': '203.0.113.7',
      }),
  ),
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
        responseLifecycle: {
          submit: mocks.submit,
          correct: mocks.correct,
          getState: mocks.getState,
        },
      },
    },
  }),
}))

import {
  correctGuestResponseFn,
  selectGoogleReviewFn,
  submitGuestResponseFn,
} from './public'

const PORTAL = {
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  portal: { id: PORTAL_ID },
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
const SUBMITTED_VIEW = {
  status: 'submitted',
  rating: 5,
  responseWithdrawalDeadline: null,
}
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

const SESSION_KEY = (action: string) => `response:${SESSION_ID}:${action}`
const NETWORK_KEY = (action: string) =>
  `response:network:${PSEUDONYM}:portal:${PORTAL_ID}:${action}`

const ratingInput = (extra: Record<string, unknown> = {}) => ({
  data: {
    token: 'pt_live',
    csrfNonce: CSRF_NONCE,
    rating: 5,
    responseConsent: true,
    ...extra,
  },
})
const submitRating = (extra?: Record<string, unknown>) =>
  submitGuestResponseFn(ratingInput(extra))
const correctRating = () => correctGuestResponseFn(ratingInput())

/** What each layer of the limiter answers; a layer is allowed unless it is named. */
const limiter = (
  answers: Readonly<{ session?: object; network?: object }> = {},
): void => {
  mocks.rateLimiterCheck.mockImplementation(async (key: string) =>
    key.includes(':network:') ? (answers.network ?? WITHIN) : (answers.session ?? WITHIN),
  )
}

/** The initial integrity assessment the lifecycle was handed (its sixth argument). */
const persistedAssessment = () => mocks.submit.mock.calls[0]?.[5]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getPublicPortal.mockResolvedValue(PORTAL)
  mocks.verifySession.mockReturnValue(SESSION)
  mocks.verifyCsrf.mockReturnValue(true)
  mocks.decidePublicExecution.mockResolvedValue({ allowed: true })
  mocks.hashNetworkPseudonym.mockReturnValue(PSEUDONYM)
  mocks.consumeGuestNetworkPressure.mockResolvedValue(WITHIN)
  mocks.submit.mockResolvedValue(SUBMITTED_VIEW)
  mocks.correct.mockResolvedValue({ ...SUBMITTED_VIEW, status: 'corrected' })
  mocks.getState.mockResolvedValue(SUBMITTED_VIEW)
  mocks.trackReviewLinkClick.mockResolvedValue(undefined)
  limiter()
})

describe('submitGuestResponseFn on a venue address', () => {
  it('spends the venue-sized budget and keeps a rating inside it as accepted', async () => {
    await expect(submitRating()).resolves.toEqual(SUBMITTED_VIEW)

    expect(mocks.rateLimiterCheck.mock.calls).toEqual([
      [SESSION_KEY('submit'), { maxRequests: 2, windowSeconds: 3600 }],
      [NETWORK_KEY('submit'), { maxRequests: 60, windowSeconds: 3600 }],
    ])
    expect(mocks.consumeGuestNetworkPressure).toHaveBeenCalledExactlyOnceWith({
      ...SCOPE,
      pseudonym: PSEUDONYM,
      action: 'rating',
      maxRequests: 60,
      windowSeconds: 3600,
    })
    expect(persistedAssessment()).toBeUndefined()
    expect(mocks.reportNetworkBudgetExhausted).not.toHaveBeenCalled()
  })

  it('keeps a rating the Redis network layer would have refused, filtered by network volume', async () => {
    limiter({ network: EXHAUSTED })

    await expect(submitRating()).resolves.toEqual(SUBMITTED_VIEW)

    expect(mocks.submit).toHaveBeenCalledTimes(1)
    expect(persistedAssessment()).toEqual({
      outcome: 'filtered_automatically',
      reasonCode: 'network_volume',
      source: 'automatic',
      actorId: 'guest-integrity-network-v1',
    })
    // Not refused: no 429 header, and the guest's Google step stays reachable.
    expect(mocks.setResponseHeader).not.toHaveBeenCalledWith(
      'Retry-After',
      expect.anything(),
    )
    expect(mocks.consumeGuestNetworkPressure).not.toHaveBeenCalled()
  })

  it('keeps a rating the durable pressure twin would have refused, filtered by network volume', async () => {
    mocks.consumeGuestNetworkPressure.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: RESET_AT,
    })

    await expect(submitRating()).resolves.toEqual(SUBMITTED_VIEW)

    expect(persistedAssessment()).toMatchObject({
      outcome: 'filtered_automatically',
      reasonCode: 'network_volume',
      actorId: 'guest-integrity-network-v1',
    })
    expect(mocks.setResponseHeader).not.toHaveBeenCalledWith(
      'Retry-After',
      expect.anything(),
    )
  })

  it('answers the normal renewable view, so the guest reaches the Google step', async () => {
    limiter({ network: EXHAUSTED })
    mocks.submit.mockResolvedValue({
      ...SUBMITTED_VIEW,
      responseWithdrawalDeadline: '2026-10-23T09:00:00.000Z',
    })
    mocks.renewUntil.mockReturnValue({ cookies: ['rk_guest=renewed'] })

    const view = await submitRating()

    expect(view).toMatchObject({ status: 'submitted', rating: 5 })
    expect(mocks.setResponseHeader).toHaveBeenCalledWith('Set-Cookie', [
      'rk_guest=renewed',
    ])
  })

  it('lets a filled honeypot win over network volume', async () => {
    limiter({ network: EXHAUSTED })

    await expect(submitRating({ honeypot: 'http://spam.example' })).resolves.toEqual(
      SUBMITTED_VIEW,
    )

    expect(persistedAssessment()).toEqual({
      outcome: 'filtered_automatically',
      reasonCode: 'honeypot_signal',
      source: 'automatic',
      actorId: 'guest-integrity-honeypot-v1',
    })
  })

  it('still refuses a new rating once this device spent its own budget', async () => {
    limiter({ session: EXHAUSTED })

    await expect(submitRating()).rejects.toMatchObject({
      name: 'GuestResponseError',
      code: 'rate_limited',
      status: 429,
    })

    expect(mocks.setResponseHeader).toHaveBeenCalledWith('Retry-After', '600')
    expect(mocks.submit).not.toHaveBeenCalled()
    // A device's budget is not a venue's: nothing to report about the network.
    expect(mocks.reportNetworkBudgetExhausted).not.toHaveBeenCalled()
  })

  it('answers a trapped bot with the decoy when the device budget is spent', async () => {
    limiter({ session: EXHAUSTED })

    const view = await submitRating({ honeypot: 'http://spam.example' })

    expect(view).toMatchObject({ status: 'submitted', rating: 5 })
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('still refuses when the limiter backend cannot answer', async () => {
    limiter({ network: { ...EXHAUSTED, backendStatus: 'unavailable' } })

    await expect(submitRating()).rejects.toMatchObject({ status: 429 })

    expect(mocks.submit).not.toHaveBeenCalled()
    // An outage is not a venue's volume.
    expect(mocks.reportNetworkBudgetExhausted).not.toHaveBeenCalled()
  })

  it('still fails when the durable pressure store cannot answer', async () => {
    mocks.consumeGuestNetworkPressure.mockRejectedValue(new Error('connection lost'))

    await expect(submitRating()).rejects.toMatchObject({ status: 500 })

    expect(mocks.submit).not.toHaveBeenCalled()
    expect(mocks.reportNetworkBudgetExhausted).not.toHaveBeenCalled()
  })

  it.each([
    ['the Redis network layer', () => limiter({ network: EXHAUSTED })],
    [
      'the durable pressure twin',
      () =>
        mocks.consumeGuestNetworkPressure.mockResolvedValue({
          allowed: false,
          remaining: 0,
          resetAt: RESET_AT,
        }),
    ],
  ])('says once, without the address, when %s is exhausted', async (_layer, exhaust) => {
    exhaust()

    await submitRating()

    expect(mocks.reportNetworkBudgetExhausted).toHaveBeenCalledExactlyOnceWith({
      action: 'submit',
    })
    const reported = JSON.stringify(mocks.reportNetworkBudgetExhausted.mock.calls)
    expect(reported).not.toContain('203.0.113.7')
    expect(reported).not.toContain(PSEUDONYM)
    expect(reported).not.toContain(SESSION_ID)
  })
})

describe('correctGuestResponseFn on a venue address', () => {
  it('spends the session and Redis network budgets but no durable rating pressure', async () => {
    await expect(correctRating()).resolves.toMatchObject({ status: 'corrected' })

    expect(mocks.rateLimiterCheck.mock.calls).toEqual([
      [SESSION_KEY('correct'), { maxRequests: 3, windowSeconds: 3600 }],
      [NETWORK_KEY('correct'), { maxRequests: 60, windowSeconds: 3600 }],
    ])
    // A correction would otherwise spend the venue's room for new ratings.
    expect(mocks.consumeGuestNetworkPressure).not.toHaveBeenCalled()
    // It keeps the pseudonym a submit uses, so the Redis key family is unchanged.
    expect(mocks.hashNetworkPseudonym).toHaveBeenCalledWith(
      expect.any(String),
      SCOPE,
      'rating',
      NOW,
    )
  })

  it('does not shrink the room for a new rating, however many corrections came first', async () => {
    for (let corrections = 0; corrections < 12; corrections += 1) await correctRating()
    expect(mocks.consumeGuestNetworkPressure).not.toHaveBeenCalled()

    await submitRating()

    expect(mocks.consumeGuestNetworkPressure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: 'rating', maxRequests: 60 }),
    )
  })

  it('still refuses a correction past the venue network layer, and says so', async () => {
    limiter({ network: EXHAUSTED })

    await expect(correctRating()).rejects.toMatchObject({ status: 429 })

    expect(mocks.correct).not.toHaveBeenCalled()
    expect(mocks.reportNetworkBudgetExhausted).toHaveBeenCalledExactlyOnceWith({
      action: 'correct',
    })
  })
})

describe('selectGoogleReviewFn on a venue address', () => {
  const selectGoogle = () =>
    selectGoogleReviewFn({ data: { token: 'pt_live', csrfNonce: CSRF_NONCE } })

  it('takes the wider navigation budget', async () => {
    mocks.rateLimiterCheck.mockImplementation(async () => WITHIN)

    await expect(selectGoogle()).resolves.toEqual({ url: 'https://g.page/r/venue' })

    const networkCall = mocks.rateLimiterCheck.mock.calls.find(([key]) =>
      String(key).includes(':network:'),
    )
    expect(networkCall?.[1]).toEqual({ maxRequests: 300, windowSeconds: 3600 })
    expect(mocks.consumeGuestNetworkPressure).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'destination_action',
        maxRequests: 300,
        windowSeconds: 3600,
      }),
    )
  })

  it('still opens Google past the venue budget, and only the analytics is dropped', async () => {
    mocks.rateLimiterCheck.mockImplementation(async (key: string) =>
      key.includes(':network:') ? EXHAUSTED : WITHIN,
    )

    await expect(selectGoogle()).resolves.toEqual({ url: 'https://g.page/r/venue' })

    expect(mocks.trackReviewLinkClick).not.toHaveBeenCalled()
    expect(mocks.reportNetworkBudgetExhausted).toHaveBeenCalledExactlyOnceWith({
      action: 'google',
    })
  })
})
