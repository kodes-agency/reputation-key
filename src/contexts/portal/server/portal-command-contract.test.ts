import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { policyDenial } from '#/shared/testing/policy-denial'
import { getRequestContext } from '#/shared/observability/request-context'
import { portalError } from '../domain/errors'

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers()),
  tenant: vi.fn(),
  policy: vi.fn(),
  scope: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  span: vi.fn(),
  end: vi.fn(),
}))

vi.mock('#/shared/auth/headers', () => ({ headersFromContext: mocks.headers }))
vi.mock('#/shared/auth/middleware', () => ({ resolveTenantContext: mocks.tenant }))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.policy,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    portalPublicApi: {
      management: {
        resolvePortalManagementScope: mocks.scope,
        getPortal: mocks.read,
        updatePortalSettings: mocks.write,
      },
    },
  }),
}))
vi.mock('#/shared/observability/trace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/shared/observability/trace')>()),
  startRequestSpan: mocks.span,
}))

import { getPortal, updatePortalSettings } from './portals'

const actor = { userId: 'user-1', organizationId: 'org-1', role: 'AccountAdmin' } as const
const input = { portalId: 'portal-1' }

describe.each([
  {
    name: 'portal.getPortal',
    method: 'GET',
    action: 'portal.read',
    capability: 'portal.read',
    effect: mocks.read,
    invoke: () => getPortal({ data: input }),
  },
  {
    name: 'portal.updatePortalSettings',
    method: 'POST',
    action: 'portal.update',
    capability: 'portal.write',
    effect: mocks.write,
    invoke: () => updatePortalSettings({ data: input }),
  },
])('$name command contract', ({ name, method, action, capability, effect, invoke }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tenant.mockResolvedValue(actor)
    mocks.policy.mockResolvedValue(undefined)
    mocks.scope.mockResolvedValue({ organizationId: 'org-1', propertyId: 'property-1' })
    mocks.span.mockReturnValue({ end: mocks.end })
    effect.mockResolvedValue({ portal: {}, tokenStatus: null })
  })

  it('keeps one named request trace around tenant resolution, policy and the use case', async () => {
    effect.mockImplementation(async () => {
      const request = getRequestContext()
      expect(request?.spanAttrs.useCase).toBe(name)
      expect(request?.commandId).toBe(request?.requestId)
      return { portal: {}, tokenStatus: null }
    })

    await withStartContext(invoke)

    expect(mocks.headers).toHaveBeenCalledTimes(1)
    expect(mocks.tenant).toHaveBeenCalledTimes(1)
    expect(mocks.policy).toHaveBeenCalledExactlyOnceWith({
      actor,
      action,
      capability,
      propertyId: 'property-1',
    })
    expect(effect).toHaveBeenCalledExactlyOnceWith(input, actor)
    expect(mocks.tenant.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.policy.mock.invocationCallOrder[0]!,
    )
    expect(mocks.policy.mock.invocationCallOrder[0]).toBeLessThan(
      effect.mock.invocationCallOrder[0]!,
    )
    expect(mocks.span).toHaveBeenCalledExactlyOnceWith(expect.any(String), method, name)
    expect(mocks.end).toHaveBeenCalledExactlyOnceWith()
  })

  it('keeps another tenant indistinguishable from a missing Portal', async () => {
    mocks.scope.mockResolvedValue({
      organizationId: 'other-org',
      propertyId: 'other-property',
    })
    await expect(withStartContext(invoke)).rejects.toMatchObject({
      name: 'PortalError',
      code: 'portal_not_found',
      status: 404,
    })
    expect(mocks.policy).not.toHaveBeenCalled()
    expect(effect).not.toHaveBeenCalled()
  })

  it('preserves a tagged policy refusal without running the use case', async () => {
    const denied = policyDenial('scope_denied')
    mocks.policy.mockRejectedValue(denied)
    await expect(withStartContext(invoke)).rejects.toBe(denied)
    expect(effect).not.toHaveBeenCalled()
    expect(mocks.end).toHaveBeenCalledExactlyOnceWith(denied)
  })

  it('keeps domain errors and unexpected failures safe on the wire', async () => {
    effect.mockRejectedValueOnce(portalError('revision_conflict', 'Please reload'))
    await expect(withStartContext(invoke)).rejects.toMatchObject({
      name: 'PortalError',
      code: 'revision_conflict',
      status: 409,
      message: 'Please reload',
    })
    effect.mockRejectedValueOnce(new Error('private database detail'))
    await expect(withStartContext(invoke)).rejects.toMatchObject({
      name: 'InternalError',
      code: 'internal_error',
      status: 500,
      message: 'Internal server error',
    })
  })
})
