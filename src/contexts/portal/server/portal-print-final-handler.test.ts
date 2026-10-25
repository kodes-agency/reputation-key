// Portal context — the final print kit's download server function (print kit
// slice 7). Invokes the real handler: the file is marked uncacheable first, then
// authorisation, then the rate limit, then the use case; nothing reaches the use
// case on any refusal.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { policyDenial } from '#/shared/testing/policy-denial'
import { portalError } from '#/contexts/portal/domain/errors'

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  resolvePortalManagementScope: vi.fn(),
  createPortalPrintFinal: vi.fn(),
  check: vi.fn(),
  setResponseHeader: vi.fn(),
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/beta-capabilities', () => ({
  assertBetaCapability: vi.fn(),
  assertGlobalCapability: vi.fn(),
  BetaCapabilityError: class BetaCapabilityError extends Error {},
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
  getExecutionPolicy: vi.fn(() => ({ decide: vi.fn() })),
}))
vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: mocks.setResponseHeader,
}))
vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    rateLimiter: { check: mocks.check },
    portalPublicApi: {
      management: {
        resolvePortalManagementScope: mocks.resolvePortalManagementScope,
        createPortalPrintFinal: mocks.createPortalPrintFinal,
      },
    },
  })),
}))
vi.mock('#/shared/observability/logger', async (importOriginal) => {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  return {
    ...(await importOriginal<typeof import('#/shared/observability/logger')>()),
    getLogger: vi.fn(() => logger),
  }
})

import { downloadPortalPrintFinal } from '#/contexts/portal/server/portal-print-final'

const CTX = { userId: 'user-1', organizationId: 'org-1', role: 'AccountAdmin' } as const
const INPUT = {
  portalId: 'portal-1',
  piece: 'tent' as const,
  orientation: 'wide' as const,
  look: 'paper' as const,
  printer: 'my_printer' as const,
  quantity: 8,
  fillSpares: false,
  languages: ['en', 'bg'] as ('en' | 'bg')[],
  callToAction: 'rate' as const,
}
const ALLOWED = {
  allowed: true,
  remaining: 1,
  resetAt: new Date(),
  backendStatus: 'available',
}
const FILE = {
  fileName: 'harbor-tent.pdf',
  contentType: 'application/pdf',
  pdf: new Uint8Array([37, 80, 68, 70]),
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveTenantContext.mockResolvedValue(CTX)
  mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  mocks.resolvePortalManagementScope.mockResolvedValue({
    organizationId: 'org-1',
    propertyId: 'property-1',
    portalId: 'portal-1',
  })
  mocks.check.mockResolvedValue(ALLOWED)
})

describe('downloadPortalPrintFinal handler (executable)', () => {
  it('makes the file as the caller, with the response marked uncacheable', async () => {
    mocks.createPortalPrintFinal.mockResolvedValue(FILE)

    await withStartContext(() => downloadPortalPrintFinal({ data: INPUT }))

    expect(mocks.createPortalPrintFinal).toHaveBeenCalledWith(INPUT, CTX)
    expect(mocks.setResponseHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store, max-age=0',
    )
    expect(mocks.setResponseHeader).toHaveBeenCalledWith('Pragma', 'no-cache')
  })

  it('checks the caller may update the Portal before anything else is spent', async () => {
    mocks.createPortalPrintFinal.mockResolvedValue(FILE)

    await withStartContext(() => downloadPortalPrintFinal({ data: INPUT }))

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledTimes(1)
    expect(mocks.resolvePortalManagementScope).toHaveBeenCalledTimes(1)
  })

  it('spends the same rate limit as the live kit and "Download again"', async () => {
    mocks.createPortalPrintFinal.mockResolvedValue(FILE)

    await withStartContext(() => downloadPortalPrintFinal({ data: INPUT }))

    expect(mocks.check.mock.calls.map(([key]) => key)).toEqual([
      'portal:address-reveal:actor:org-1:user-1',
      'portal:address-reveal:organization:org-1',
    ])
  })

  it('marks the response uncacheable even when the request is refused', async () => {
    mocks.check.mockResolvedValue({ ...ALLOWED, allowed: false })

    await expect(
      withStartContext(() => downloadPortalPrintFinal({ data: INPUT })),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429 })

    expect(mocks.setResponseHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store, max-age=0',
    )
    expect(mocks.createPortalPrintFinal).not.toHaveBeenCalled()
  })

  it('does not spend the rate limit or make the file when the Portal scope is denied', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(policyDenial())

    await expect(
      withStartContext(() => downloadPortalPrintFinal({ data: INPUT })),
    ).rejects.toMatchObject({ name: 'AuthError', code: 'scope_denied', status: 403 })

    expect(mocks.check).not.toHaveBeenCalled()
    expect(mocks.createPortalPrintFinal).not.toHaveBeenCalled()
  })

  it('answers a Portal that does not exist as a 404', async () => {
    mocks.resolvePortalManagementScope.mockResolvedValue(null)

    await expect(
      withStartContext(() => downloadPortalPrintFinal({ data: INPUT })),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })

    expect(mocks.createPortalPrintFinal).not.toHaveBeenCalled()
  })

  it('answers a language the Portal does not offer as a 400', async () => {
    mocks.createPortalPrintFinal.mockRejectedValue(
      portalError('locale_not_offered', 'Choose languages this portal offers'),
    )

    await expect(
      withStartContext(() => downloadPortalPrintFinal({ data: INPUT })),
    ).rejects.toMatchObject({ code: 'locale_not_offered', status: 400 })
  })
})
