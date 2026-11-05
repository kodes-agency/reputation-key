import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { getRequestContext } from '#/shared/observability/request-context'
import { serverFunctionErrorAdapter } from '#/shared/auth/server-function-error'
import {
  createExecutionPolicy,
  initExecutionPolicy,
  resetExecutionPolicy,
} from '#/shared/auth/execution-policy'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { resetTenantCache } from '#/shared/auth/middleware'
import { propertyError } from '../domain/errors'

const fakes = vi.hoisted(() => ({
  getSession: vi.fn(),
  getActiveMember: vi.fn(),
  membership: vi.fn(),
  grants: vi.fn(),
  update: vi.fn(),
  getContainer: vi.fn(),
  headers: new Headers({ cookie: 'better-auth.session_token=unit-session' }),
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: async () => fakes.headers,
}))
vi.mock('#/shared/auth/auth', () => ({
  getAuth: () => ({
    api: { getSession: fakes.getSession, getActiveMember: fakes.getActiveMember },
  }),
}))
vi.mock('#/shared/auth/user-organization-membership-authority', () => ({
  checkUserOrganizationMembership: fakes.membership,
}))
vi.mock('#/shared/db', () => ({ getDb: () => ({}) }))
vi.mock('#/shared/db/role-definitions', () => ({
  fetchPermissionVersion: async () => 1,
}))
vi.mock('#/composition', () => ({ getContainer: fakes.getContainer }))

import { archiveProperty, updateProperty } from './properties'

const data = { propertyId: 'property-1', name: 'Harbour Hotel' }
const invoke = () => withStartContext(() => updateProperty({ data }))

beforeEach(() => {
  vi.resetAllMocks()
  resetTenantCache()
  fakes.getSession.mockResolvedValue({
    user: { id: 'user-1' },
    session: { activeOrganizationId: 'org-1' },
  })
  fakes.getActiveMember.mockResolvedValue({ role: 'owner' })
  fakes.membership.mockResolvedValue({ kind: 'allow' })
  fakes.grants.mockResolvedValue([])
  fakes.getContainer.mockReturnValue({
    propertyPublicApi: { management: { updateProperty: fakes.update } },
  })
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
  initExecutionPolicy(createExecutionPolicy({ listAccessiblePropertyIds: fakes.grants }))
})

afterEach(() => {
  resetExecutionPolicy()
  resetCapabilityPolicyStore()
  resetTenantCache()
})

describe('Property command shell with real tenant and execution policy', () => {
  it('refuses a signed-out request before looking up Property services', async () => {
    fakes.getSession.mockResolvedValue(null)
    await expect(invoke()).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
    expect(fakes.getContainer).not.toHaveBeenCalled()
  })

  it('refuses an inactive member role before looking up Property services', async () => {
    fakes.getActiveMember.mockResolvedValue({ role: 'member' })
    await expect(invoke()).rejects.toMatchObject({
      code: 'beta_role_inactive',
      status: 403,
    })
    expect(fakes.getContainer).not.toHaveBeenCalled()
  })

  it('refuses Archive to a PropertyManager even with a current grant', async () => {
    fakes.getActiveMember.mockResolvedValue({ role: 'admin' })
    fakes.grants.mockResolvedValue([data.propertyId])
    await expect(
      withStartContext(() =>
        archiveProperty({
          data: { propertyId: data.propertyId, reason: 'Closed for winter' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })
    expect(fakes.getContainer).not.toHaveBeenCalled()
  })

  it('validates the input before resolving a session or looking up services', async () => {
    // The uncompiled fetcher executes its client chain; validation runs only
    // through the server entry point used by the compiled transport.
    const response = await withStartContext(() =>
      updateProperty.__executeServer({
        method: 'POST',
        data: { ...data, propertyId: '' },
      }),
    )
    expect(response).toMatchObject({ error: expect.any(Error) })
    expect(fakes.getSession).not.toHaveBeenCalled()
    expect(fakes.getContainer).not.toHaveBeenCalled()
  })

  it('refuses a PropertyManager without a current Property grant', async () => {
    fakes.getActiveMember.mockResolvedValue({ role: 'admin' })
    await expect(invoke()).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
    expect(fakes.grants).toHaveBeenCalledWith('org-1', 'user-1')
    expect(fakes.getContainer).not.toHaveBeenCalled()
  })

  it('passes the resolved tenant and unchanged input after a current grant', async () => {
    fakes.getActiveMember.mockResolvedValue({ role: 'admin' })
    fakes.grants.mockResolvedValue([data.propertyId])
    fakes.update.mockRejectedValue(
      propertyError('stale_property', 'Refresh and try again.'),
    )
    await expect(invoke()).rejects.toMatchObject({ code: 'stale_property', status: 409 })
    expect(fakes.update).toHaveBeenCalledWith(
      data,
      expect.objectContaining({
        userId: 'user-1',
        organizationId: 'org-1',
        role: 'PropertyManager',
      }),
    )
    expect(fakes.getSession).toHaveBeenCalledWith({ headers: fakes.headers })
  })

  it.each([
    ['property_not_found', 404],
    ['invalid_name', 400],
    ['stale_property', 409],
  ] as const)('preserves declared domain status for %s', async (code, status) => {
    fakes.update.mockRejectedValue(propertyError(code, 'Property request refused.'))
    await expect(invoke()).rejects.toMatchObject({
      _tag: 'PropertyError',
      code,
      status,
      message: 'Property request refused.',
    })
  })

  it('answers an unknown failure opaquely with its request ID across serialization', async () => {
    let requestId: string | undefined
    const original = new Error('SQL parameters: private-customer-value')
    fakes.update.mockImplementation(async () => {
      requestId = getRequestContext()?.requestId
      throw original
    })
    const failure = await invoke().catch((error: unknown) => error)
    expect(serverFunctionErrorAdapter.test(failure)).toBe(true)
    if (!serverFunctionErrorAdapter.test(failure))
      throw new Error('Expected a wire error')
    expect(requestId).toEqual(expect.any(String))
    const wire = serverFunctionErrorAdapter.toSerializable(failure)
    expect(wire).toMatchObject({
      name: 'InternalError',
      code: 'internal_error',
      status: 500,
      message: 'Internal server error',
      requestId,
    })
    expect(JSON.stringify(wire)).not.toContain('private-customer-value')
    const restored = serverFunctionErrorAdapter.fromSerializable(wire)
    expect(restored).toMatchObject({ requestId })
    expect(restored.cause).toBeUndefined()
    expect(failure.cause).toBe(original)
  })
})
