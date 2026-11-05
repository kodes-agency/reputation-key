// Portal context — the print kit server functions (round 4, slice 45).
// Invokes the real handlers: the file is marked uncacheable first, then
// authorisation, then the rate limit, then the use case; nothing reaches the
// use case on any refusal.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { portalError } from '#/contexts/portal/domain/errors'

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  resolvePortalManagementScope: vi.fn(),
  getPortalPrintKit: vi.fn(),
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
        getPortalPrintKit: mocks.getPortalPrintKit,
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

import { getPortalPrintKit } from '#/contexts/portal/server/portal-print-kit'

const CTX = { userId: 'user-1', organizationId: 'org-1', role: 'AccountAdmin' } as const
const READ_INPUT = { portalId: 'portal-1' } as const
const ALLOWED = {
  allowed: true,
  remaining: 1,
  resetAt: new Date(),
  backendStatus: 'available',
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

describe('getPortalPrintKit handler (executable)', () => {
  it('reads the print kit for the Portal as the caller', async () => {
    mocks.getPortalPrintKit.mockResolvedValue({ portalId: 'portal-1' })

    await withStartContext(() => getPortalPrintKit({ data: READ_INPUT }))

    expect(mocks.getPortalPrintKit).toHaveBeenCalledWith(READ_INPUT, CTX)
  })

  it('discloses nothing, so it neither limits the rate nor marks the response', async () => {
    mocks.getPortalPrintKit.mockResolvedValue({})
    await withStartContext(() => getPortalPrintKit({ data: READ_INPUT }))
    expect(mocks.check).not.toHaveBeenCalled()
    expect(mocks.setResponseHeader).not.toHaveBeenCalled()
  })

  it('answers a Portal that does not exist as a 404', async () => {
    mocks.getPortalPrintKit.mockRejectedValue(
      portalError('portal_not_found', 'portal not found'),
    )
    await expect(
      withStartContext(() => getPortalPrintKit({ data: READ_INPUT })),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })
  })
})
