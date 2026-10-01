// Portal context — "Download again" server function (round 4, slice 33).
// Invokes the real handler: no-store first, then authorisation, then the rate
// limit, then the use case, and nothing reaches the use case on any refusal.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { portalError } from '#/contexts/portal/domain/errors'

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  resolvePortalManagementScope: vi.fn(),
  revealPortalAddress: vi.fn(),
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
        revealPortalAddress: mocks.revealPortalAddress,
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

import { revealPortalAddress } from '#/contexts/portal/server/portals'

const CTX = { userId: 'user-1', organizationId: 'org-1', role: 'AccountAdmin' } as const
const INPUT = { portalId: 'portal-1', purpose: 'download' } as const
const ALLOWED = {
  allowed: true,
  remaining: 1,
  resetAt: new Date(),
  backendStatus: 'available',
}

describe('revealPortalAddress handler (executable)', () => {
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

  it('returns the address with the response marked uncacheable', async () => {
    const revealed = { publicUrl: 'https://example.test/p/x', version: 1 }
    mocks.revealPortalAddress.mockResolvedValue(revealed)

    await withStartContext(() => revealPortalAddress({ data: INPUT }))

    expect(mocks.revealPortalAddress).toHaveBeenCalledWith(INPUT, CTX)
    expect(mocks.setResponseHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store, max-age=0',
    )
    expect(mocks.setResponseHeader).toHaveBeenCalledWith('Pragma', 'no-cache')
  })

  it('marks the response uncacheable even when the request is refused', async () => {
    mocks.check.mockResolvedValue({ ...ALLOWED, allowed: false })

    await expect(
      withStartContext(() => revealPortalAddress({ data: INPUT })),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429 })

    expect(mocks.setResponseHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store, max-age=0',
    )
    expect(mocks.revealPortalAddress).not.toHaveBeenCalled()
  })

  it('spends the rate limit for this actor and Organization', async () => {
    mocks.revealPortalAddress.mockResolvedValue({})

    await withStartContext(() => revealPortalAddress({ data: INPUT }))

    expect(mocks.check.mock.calls.map(([key]) => key)).toEqual([
      'portal:address-reveal:actor:org-1:user-1',
      'portal:address-reveal:organization:org-1',
    ])
  })

  it('does not spend the rate limit or reveal when the Portal scope is denied', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'property_disabled' }),
    )

    await expect(
      withStartContext(() => revealPortalAddress({ data: INPUT })),
    ).rejects.toBeDefined()

    expect(mocks.check).not.toHaveBeenCalled()
    expect(mocks.revealPortalAddress).not.toHaveBeenCalled()
  })

  it('answers an unavailable address as a 422 the page can explain', async () => {
    mocks.revealPortalAddress.mockRejectedValue(
      portalError('address_unavailable', 'Replace the code to get a new set.'),
    )

    await expect(
      withStartContext(() => revealPortalAddress({ data: INPUT })),
    ).rejects.toMatchObject({ code: 'address_unavailable', status: 422 })
  })
})
