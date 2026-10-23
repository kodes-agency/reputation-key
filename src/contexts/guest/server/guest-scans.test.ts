// Guest context — the scan beacon's answers.
//
// Runtime-imports the production handler, with its own validator and the real
// `tracedHandler` around it, so what is asserted is what an anonymous caller receives:
// a Portal that is not there (unknown token, closed Portal, replaced code) is the
// tagged `portal_not_found` and must be answered 404 like every sibling, never as an
// untagged 500.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { guestError, type GuestErrorCode } from '../domain/errors'

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001'
const PROPERTY_ID = '10000000-0000-4000-8000-000000000002'
const PORTAL_ID = '10000000-0000-4000-8000-000000000003'
const CSRF_NONCE = '10000000-0000-4000-8000-000000000004'
const SESSION_ID = '10000000-0000-4000-8000-000000000005'
const NOW = new Date('2026-10-13T09:00:00.000Z')
const RESET_AT = new Date('2026-10-13T09:10:00.000Z')

const mocks = vi.hoisted(() => ({
  getPublicPortal: vi.fn(),
  verifySession: vi.fn(),
  verifyCsrf: vi.fn(),
  hashNetworkPseudonym: vi.fn(),
  consumeGuestNetworkPressure: vi.fn(),
  recordScan: vi.fn(),
  reportObservationLoss: vi.fn(),
  reportNetworkBudgetExhausted: vi.fn(),
  rateLimiterCheck: vi.fn(),
  decidePublicExecution: vi.fn(),
  setResponseHeader: vi.fn(),
  logError: vi.fn(),
  enrichSpan: vi.fn(),
  issueSession: vi.fn(),
  responseState: vi.fn(),
  resolveLinkAndTrack: vi.fn(),
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
  headersFromContext: vi.fn(async () => new Headers({ cookie: 'rk_guest=signed' })),
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
vi.mock('#/shared/observability/request-context', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('#/shared/observability/request-context')>()
  return {
    ...original,
    enrichSpan: (attrs: Parameters<typeof original.enrichSpan>[0]) => {
      mocks.enrichSpan(attrs)
      original.enrichSpan(attrs)
    },
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
          issue: mocks.issueSession,
        },
        responseLifecycle: { getState: mocks.responseState },
        resolveLinkAndTrack: mocks.resolveLinkAndTrack,
        guestPublicRuntime: { hashNetworkPseudonym: mocks.hashNetworkPseudonym },
        consumeGuestNetworkPressure: mocks.consumeGuestNetworkPressure,
        recordScan: mocks.recordScan,
        reportObservationLoss: mocks.reportObservationLoss,
        reportNetworkBudgetExhausted: mocks.reportNetworkBudgetExhausted,
      },
    },
  }),
}))

import {
  getPublicPortal,
  guestErrorStatus,
  recordScanFn,
  resolvePublicPortalLink,
} from './guest-scans'

const PORTAL = {
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  portal: { id: PORTAL_ID },
  responseConfiguration: { publicationSnapshotId: 'snapshot-1' },
}

const ALLOWED = { allowed: true, remaining: 1, resetAt: RESET_AT } as const

const beacon = (token = 'pt_live') =>
  recordScanFn({ data: { token, csrfNonce: CSRF_NONCE, accessArtifactId: null } })

/**
 * How each failure the handler reported was classified. The request span writes a
 * line of its own for every failed request, which names no kind and is left out.
 */
const loggedErrorTypes = () =>
  mocks.logError.mock.calls
    .map(([entry]) => (entry as { errorType?: string }).errorType)
    .filter((errorType) => errorType !== undefined)

// The status every Guest refusal is answered with, stated by hand. These cases
// used to run against a copy of the mapping kept in `public.test.ts`, which
// passed whatever production answered. The `Record` makes a new refusal code a
// compile error here until its status is written down.
describe('guestErrorStatus', () => {
  const STATUS_BY_CODE: Record<GuestErrorCode, number> = {
    rate_limit_exceeded: 429,
    invalid_rating: 400,
    duplicate_rating: 400,
    duplicate_feedback: 400,
    feedback_too_long: 400,
    feedback_empty: 400,
    invalid_source: 400,
    invalid_session: 400,
    portal_not_found: 404,
    portal_inactive: 410,
    forbidden: 403,
  }

  it.each(Object.entries(STATUS_BY_CODE) as ReadonlyArray<[GuestErrorCode, number]>)(
    'answers %s with %i',
    (code, status) => {
      expect(guestErrorStatus(code)).toBe(status)
    },
  )
})

describe('recordScanFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPublicPortal.mockResolvedValue(PORTAL)
    mocks.verifySession.mockReturnValue({ sessionId: SESSION_ID })
    mocks.verifyCsrf.mockReturnValue(true)
    mocks.decidePublicExecution.mockResolvedValue({ allowed: true })
    mocks.hashNetworkPseudonym.mockReturnValue('pseudonym-1')
    mocks.rateLimiterCheck.mockResolvedValue({ ...ALLOWED, backendStatus: 'available' })
    mocks.consumeGuestNetworkPressure.mockResolvedValue(ALLOWED)
    mocks.recordScan.mockResolvedValue('qualified')
  })

  it('answers a Portal that is not there with 404, not as a server fault', async () => {
    mocks.getPublicPortal.mockRejectedValue(
      guestError('portal_not_found', 'Portal not found'),
    )

    await expect(beacon('pt_unknown_or_closed')).rejects.toMatchObject({
      name: 'GuestError',
      code: 'portal_not_found',
      status: 404,
      message: 'Portal not found',
    })

    // One mapped refusal, and no untagged failure with a stack beside it.
    expect(loggedErrorTypes()).toEqual(['GuestError'])
  })

  it('gives an unknown token and a session that does not fit the same answer', async () => {
    mocks.getPublicPortal.mockRejectedValueOnce(
      guestError('portal_not_found', 'Portal not found'),
    )
    const unknownToken = await beacon('pt_unknown').catch((error: unknown) => error)
    mocks.verifySession.mockReturnValue(null)
    const foreignSession = await beacon().catch((error: unknown) => error)

    const wire = (error: unknown) => {
      const { name, code, status, message } = error as Error & {
        code: string
        status: number
      }
      return { name, code, status, message }
    }
    expect(wire(unknownToken)).toEqual(wire(foreignSession))
    expect(wire(unknownToken).status).toBe(404)
  })

  it('stops at the token: no limiter key, pressure record or scan for a Portal that is not there', async () => {
    mocks.getPublicPortal.mockRejectedValue(
      guestError('portal_not_found', 'Portal not found'),
    )

    await expect(beacon('pt_unknown')).rejects.toMatchObject({ status: 404 })

    expect(mocks.verifySession).not.toHaveBeenCalled()
    expect(mocks.rateLimiterCheck).not.toHaveBeenCalled()
    expect(mocks.consumeGuestNetworkPressure).not.toHaveBeenCalled()
    expect(mocks.recordScan).not.toHaveBeenCalled()
  })

  it('still reports a lookup that failed for another reason as a sanitised 500', async () => {
    mocks.getPublicPortal.mockRejectedValue(new Error('connection terminated'))

    await expect(beacon()).rejects.toMatchObject({
      name: 'InternalError',
      code: 'internal_error',
      status: 500,
      message: 'Internal server error',
    })
    expect(loggedErrorTypes()).toEqual(['UntaggedError'])
  })

  it('limits by the session and by the network on the resolved Portal before it records', async () => {
    await expect(beacon()).resolves.toEqual({ success: true, retryable: false })

    expect(mocks.hashNetworkPseudonym).toHaveBeenCalledWith(
      expect.any(String),
      { organizationId: ORGANIZATION_ID, propertyId: PROPERTY_ID, portalId: PORTAL_ID },
      'qualified_scan',
      NOW,
    )
    expect(mocks.rateLimiterCheck.mock.calls.map(([key]) => key)).toEqual([
      `scan:${SESSION_ID}`,
      `scan:network:pseudonym-1:portal:${PORTAL_ID}`,
    ])
    expect(mocks.rateLimiterCheck.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.recordScan.mock.invocationCallOrder.at(0) ?? 0,
    )
    expect(mocks.recordScan).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        portalId: PORTAL_ID,
        publicationSnapshotId: 'snapshot-1',
        rawToken: 'pt_live',
        sessionId: SESSION_ID,
        accessArtifactId: null,
      }),
    )
  })

  it('refuses an exhausted budget with 429 and a Retry-After, and records nothing', async () => {
    mocks.rateLimiterCheck.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: RESET_AT,
      backendStatus: 'available',
    })

    await expect(beacon()).rejects.toMatchObject({
      name: 'GuestError',
      code: 'rate_limit_exceeded',
      status: 429,
    })

    expect(mocks.setResponseHeader).toHaveBeenCalledWith('Retry-After', '600')
    expect(mocks.recordScan).not.toHaveBeenCalled()
    // A full budget is a refusal, not lost observation.
    expect(mocks.reportObservationLoss).not.toHaveBeenCalled()
  })

  describe('on a venue address', () => {
    const NETWORK_KEY = `scan:network:pseudonym-1:portal:${PORTAL_ID}`
    const EXHAUSTED = {
      allowed: false,
      remaining: 0,
      resetAt: RESET_AT,
      backendStatus: 'available',
    } as const
    const available = { ...ALLOWED, backendStatus: 'available' } as const

    it('takes the venue-sized budget on the Redis layer and its durable twin', async () => {
      await beacon()

      expect(mocks.rateLimiterCheck.mock.calls).toEqual([
        [`scan:${SESSION_ID}`, { maxRequests: 3, windowSeconds: 3600 }],
        [NETWORK_KEY, { maxRequests: 300, windowSeconds: 3600 }],
      ])
      expect(mocks.consumeGuestNetworkPressure).toHaveBeenCalledExactlyOnceWith({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        portalId: PORTAL_ID,
        pseudonym: 'pseudonym-1',
        action: 'qualified_scan',
        maxRequests: 300,
        windowSeconds: 3600,
      })
      expect(mocks.reportNetworkBudgetExhausted).not.toHaveBeenCalled()
    })

    it('says once, without the address, when the Redis network layer refuses', async () => {
      mocks.rateLimiterCheck.mockImplementation(async (key: string) =>
        key === NETWORK_KEY ? EXHAUSTED : available,
      )

      await expect(beacon()).rejects.toMatchObject({ status: 429 })

      expect(mocks.reportNetworkBudgetExhausted).toHaveBeenCalledExactlyOnceWith({
        action: 'scan',
      })
      expect(mocks.recordScan).not.toHaveBeenCalled()
    })

    it('says once when the durable pressure twin refuses', async () => {
      mocks.consumeGuestNetworkPressure.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: RESET_AT,
      })

      await expect(beacon()).rejects.toMatchObject({ status: 429 })

      expect(mocks.reportNetworkBudgetExhausted).toHaveBeenCalledExactlyOnceWith({
        action: 'scan',
      })
      expect(mocks.recordScan).not.toHaveBeenCalled()
    })

    it('says nothing about the network when only this device is out of budget', async () => {
      mocks.rateLimiterCheck.mockImplementation(async (key: string) =>
        key === `scan:${SESSION_ID}` ? EXHAUSTED : available,
      )

      await expect(beacon()).rejects.toMatchObject({ status: 429 })

      expect(mocks.reportNetworkBudgetExhausted).not.toHaveBeenCalled()
    })

    it('reports a limiter outage as lost observation, not as venue volume', async () => {
      mocks.rateLimiterCheck.mockResolvedValue({
        ...EXHAUSTED,
        backendStatus: 'unavailable',
      })

      await expect(beacon()).rejects.toMatchObject({ status: 429 })

      expect(mocks.reportObservationLoss).toHaveBeenCalledWith('scan')
      expect(mocks.reportNetworkBudgetExhausted).not.toHaveBeenCalled()
    })
  })
})

// A print code (ADR 0069) is a 20 character token on the same routes as a long
// address: the validators take it, and the beacon asks for no marker with it.
describe('a print code on the guest routes', () => {
  const PRINT_CODE = '7K3QZ0VD9MWX4HT2BN6R'

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPublicPortal.mockResolvedValue(PORTAL)
    mocks.verifySession.mockReturnValue({ sessionId: SESSION_ID })
    mocks.verifyCsrf.mockReturnValue(true)
    mocks.decidePublicExecution.mockResolvedValue({ allowed: true })
    mocks.hashNetworkPseudonym.mockReturnValue('pseudonym-1')
    mocks.rateLimiterCheck.mockResolvedValue({ ...ALLOWED, backendStatus: 'available' })
    mocks.consumeGuestNetworkPressure.mockResolvedValue(ALLOWED)
    mocks.recordScan.mockResolvedValue('qualified')
  })

  it('reaches the scan beacon with no marker and the code as the address', async () => {
    await expect(beacon(PRINT_CODE)).resolves.toEqual({ success: true, retryable: false })

    expect(mocks.getPublicPortal).toHaveBeenCalledExactlyOnceWith({ token: PRINT_CODE })
    expect(mocks.recordScan).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ rawToken: PRINT_CODE, accessArtifactId: null }),
    )
  })

  it('reaches the link fallback, which asks for the Portal by the code', async () => {
    mocks.resolveLinkAndTrack.mockResolvedValue({ url: 'https://example.com' })

    await expect(
      resolvePublicPortalLink({ data: { token: PRINT_CODE, linkId: 'link-1' } }),
    ).resolves.toEqual({ url: 'https://example.com' })

    expect(mocks.resolveLinkAndTrack).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ token: PRINT_CODE }),
    )
  })

  describe('on the page read', () => {
    const page = (addressShape: 'long' | 'short') => ({
      ...PORTAL,
      addressShape,
      portal: {
        id: PORTAL_ID,
        name: 'Lobby',
        description: null,
        heroImageUrl: null,
        theme: null,
        organizationName: 'Hotel One',
      },
      categories: [],
      links: [],
      reviewGateway: {
        privateFeedbackThreshold: 3,
        googleReview: { status: 'available' },
      },
      localization: {
        selectedLocale: 'en',
        primaryLocale: 'en',
        availableLocales: ['en'],
        languagePackVersion: 'guest-ui-en-v1',
      },
      guestSurface: 'legacy',
      immersive: null,
    })

    beforeEach(() => {
      mocks.verifySession.mockReturnValue({
        sessionId: SESSION_ID,
        csrfNonce: CSRF_NONCE,
        guestLocale: 'en',
      })
      mocks.responseState.mockResolvedValue(null)
    })

    it.each(['long', 'short'] as const)(
      'records only that it was a %s address, and keeps that from the browser',
      async (addressShape) => {
        mocks.getPublicPortal.mockResolvedValue(page(addressShape))
        const token = addressShape === 'short' ? PRINT_CODE : 'pt_live'

        const loaderData = await getPublicPortal({ data: { token } })

        expect(mocks.enrichSpan).toHaveBeenCalledWith({ addressShape })
        expect(loaderData).not.toHaveProperty('addressShape')
        expect(JSON.stringify(loaderData)).not.toContain(token)
      },
    )

    it('reads the page of a print code by the same lookup as any address', async () => {
      mocks.getPublicPortal.mockResolvedValue(page('short'))

      await getPublicPortal({ data: { token: PRINT_CODE } })

      expect(mocks.getPublicPortal).toHaveBeenCalledWith(
        expect.objectContaining({ token: PRINT_CODE }),
      )
    })
  })
})
