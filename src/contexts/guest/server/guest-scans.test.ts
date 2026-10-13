// Guest context — the scan beacon's answers.
//
// Runtime-imports the production handler, with its own validator and the real
// `tracedHandler` around it, so what is asserted is what an anonymous caller receives:
// a Portal that is not there (unknown token, closed Portal, replaced code) is the
// tagged `portal_not_found` and must be answered 404 like every sibling, never as an
// untagged 500.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { guestError } from '../domain/errors'

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
  rateLimiterCheck: vi.fn(),
  decidePublicExecution: vi.fn(),
  setResponseHeader: vi.fn(),
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
vi.mock('#/composition', () => ({
  getContainer: () => ({
    clock: () => NOW,
    rateLimiter: { check: mocks.rateLimiterCheck },
    guestPublicApi: {
      requests: {
        getPublicPortal: mocks.getPublicPortal,
        guestSessions: { verify: mocks.verifySession, verifyCsrf: mocks.verifyCsrf },
        guestPublicRuntime: { hashNetworkPseudonym: mocks.hashNetworkPseudonym },
        consumeGuestNetworkPressure: mocks.consumeGuestNetworkPressure,
        recordScan: mocks.recordScan,
        reportObservationLoss: mocks.reportObservationLoss,
      },
    },
  }),
}))

import { recordScanFn } from './guest-scans'

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
})
