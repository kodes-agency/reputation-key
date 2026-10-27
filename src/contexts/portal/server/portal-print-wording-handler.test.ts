// Portal context — the final print kit's "Save wording" server function
// (2026-10-27). Invokes the real handler: it is guarded exactly as the download
// beside it (the Portal's scope and the right to update it, then the address rate
// limit), and nothing reaches the use case on any refusal. It makes no file, so it
// has nothing to mark uncacheable.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { policyDenial } from '#/shared/testing/policy-denial'
import { portalError } from '#/contexts/portal/domain/errors'

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  resolvePortalManagementScope: vi.fn(),
  savePortalPrintWording: vi.fn(),
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
        savePortalPrintWording: mocks.savePortalPrintWording,
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

import { savePortalPrintWording } from '#/contexts/portal/server/portal-print-final'

const CTX = { userId: 'user-1', organizationId: 'org-1', role: 'AccountAdmin' } as const
const INPUT = {
  portalId: 'portal-1',
  callToAction: 'how_was_stay' as const,
  customWords: { en: { headline: 'Thanks for staying', subline: 'Tell us more' } },
}
const SAVED = { callToAction: 'how_was_stay', customWords: INPUT.customWords }
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
  mocks.savePortalPrintWording.mockResolvedValue(SAVED)
})

describe('savePortalPrintWording handler (executable)', () => {
  it('saves the wording as the caller', async () => {
    await withStartContext(() => savePortalPrintWording({ data: INPUT }))

    expect(mocks.savePortalPrintWording).toHaveBeenCalledWith(INPUT, CTX)
  })

  it('asks the policy for the download’s right on the Portal’s Property, as the download does', async () => {
    await withStartContext(() => savePortalPrintWording({ data: INPUT }))

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledTimes(1)
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: CTX,
      action: 'portal.update',
      capability: 'portal.write',
      propertyId: 'property-1',
    })
  })

  it('spends the same rate limit as the download, actor first', async () => {
    await withStartContext(() => savePortalPrintWording({ data: INPUT }))

    expect(mocks.check.mock.calls.map(([key]) => key)).toEqual([
      'portal:address-reveal:actor:org-1:user-1',
      'portal:address-reveal:organization:org-1',
    ])
  })

  it('does not spend the rate limit or save when the policy denies the caller', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(policyDenial())

    await expect(
      withStartContext(() => savePortalPrintWording({ data: INPUT })),
    ).rejects.toMatchObject({ name: 'AuthError', code: 'scope_denied', status: 403 })

    expect(mocks.check).not.toHaveBeenCalled()
    expect(mocks.savePortalPrintWording).not.toHaveBeenCalled()
  })

  it('answers a Portal that does not exist as a 404, and spends nothing', async () => {
    mocks.resolvePortalManagementScope.mockResolvedValue(null)

    await expect(
      withStartContext(() => savePortalPrintWording({ data: INPUT })),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })

    expect(mocks.check).not.toHaveBeenCalled()
    expect(mocks.savePortalPrintWording).not.toHaveBeenCalled()
  })

  it('answers a Portal of another Organization as a 404, never asking the policy', async () => {
    mocks.resolvePortalManagementScope.mockResolvedValue({
      organizationId: 'org-2',
      propertyId: 'property-9',
      portalId: 'portal-1',
    })

    await expect(
      withStartContext(() => savePortalPrintWording({ data: INPUT })),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })

    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
    expect(mocks.savePortalPrintWording).not.toHaveBeenCalled()
  })

  it('answers a caller over the rate limit as a 429 and saves nothing', async () => {
    mocks.check.mockResolvedValue({ ...ALLOWED, allowed: false })

    await expect(
      withStartContext(() => savePortalPrintWording({ data: INPUT })),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429 })

    expect(mocks.savePortalPrintWording).not.toHaveBeenCalled()
  })

  it('answers the use case’s refusal of an offer as the Portal error the client reads', async () => {
    mocks.savePortalPrintWording.mockRejectedValue(
      portalError('print_format_not_offered', 'Remove the offer', {
        cause: 'remove_offer',
      }),
    )

    await expect(
      withStartContext(() => savePortalPrintWording({ data: INPUT })),
    ).rejects.toMatchObject({ code: 'print_format_not_offered' })
  })
})
