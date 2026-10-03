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
  createPortalPrintKit: vi.fn(),
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
        createPortalPrintKit: mocks.createPortalPrintKit,
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

import {
  downloadPortalPrintKit,
  getPortalPrintKit,
} from '#/contexts/portal/server/portal-print-kit'

const CTX = { userId: 'user-1', organizationId: 'org-1', role: 'AccountAdmin' } as const
const READ_INPUT = { portalId: 'portal-1' } as const
const DOWNLOAD_INPUT = {
  portalId: 'portal-1',
  piece: 'table_tent' as const,
  languages: ['en', 'bg'] as ('en' | 'bg')[],
  callToAction: 'rate' as const,
}
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

describe('downloadPortalPrintKit handler (executable)', () => {
  it('makes the file as the caller, with the response marked uncacheable', async () => {
    mocks.createPortalPrintKit.mockResolvedValue({
      fileName: 'harbor-table-tent.pdf',
      contentType: 'application/pdf',
      pdf: new Uint8Array([37, 80, 68, 70]),
    })

    await withStartContext(() => downloadPortalPrintKit({ data: DOWNLOAD_INPUT }))

    expect(mocks.createPortalPrintKit).toHaveBeenCalledWith(DOWNLOAD_INPUT, CTX)
    expect(mocks.setResponseHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store, max-age=0',
    )
    expect(mocks.setResponseHeader).toHaveBeenCalledWith('Pragma', 'no-cache')
  })

  it('marks the response uncacheable even when the request is refused', async () => {
    mocks.check.mockResolvedValue({ ...ALLOWED, allowed: false })

    await expect(
      withStartContext(() => downloadPortalPrintKit({ data: DOWNLOAD_INPUT })),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429 })

    expect(mocks.setResponseHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store, max-age=0',
    )
    expect(mocks.createPortalPrintKit).not.toHaveBeenCalled()
  })

  it('spends the same rate limit as "Download again"', async () => {
    mocks.createPortalPrintKit.mockResolvedValue({
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      pdf: new Uint8Array(),
    })

    await withStartContext(() => downloadPortalPrintKit({ data: DOWNLOAD_INPUT }))

    expect(mocks.check.mock.calls.map(([key]) => key)).toEqual([
      'portal:address-reveal:actor:org-1:user-1',
      'portal:address-reveal:organization:org-1',
    ])
  })

  it('does not spend the rate limit or make the file when the Portal scope is denied', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'property_disabled' }),
    )

    await expect(
      withStartContext(() => downloadPortalPrintKit({ data: DOWNLOAD_INPUT })),
    ).rejects.toBeDefined()

    expect(mocks.check).not.toHaveBeenCalled()
    expect(mocks.createPortalPrintKit).not.toHaveBeenCalled()
  })

  it('answers a code that cannot be fetched again as a 422 the page can explain', async () => {
    mocks.createPortalPrintKit.mockRejectedValue(
      portalError('address_unavailable', 'Replace the code to get a new set.'),
    )

    await expect(
      withStartContext(() => downloadPortalPrintKit({ data: DOWNLOAD_INPUT })),
    ).rejects.toMatchObject({ code: 'address_unavailable', status: 422 })
  })

  it('answers a language the Portal does not offer as a 400', async () => {
    mocks.createPortalPrintKit.mockRejectedValue(
      portalError('locale_not_offered', 'Choose languages this portal offers'),
    )

    await expect(
      withStartContext(() => downloadPortalPrintKit({ data: DOWNLOAD_INPUT })),
    ).rejects.toMatchObject({ code: 'locale_not_offered', status: 400 })
  })
})
