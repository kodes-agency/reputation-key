// The updateOrganization server function adapts the call to the request the
// build publishes (`identityPublicApi.requests.updateOrganization`). It composes
// no use case of its own: one instance, wired once, is what production runs and
// what the build tests exercise.

import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { identityError } from '../domain/errors'

const mocks = vi.hoisted(() => ({
  builtUpdateOrganization: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers({ cookie: 'session=current' })),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    identityPublicApi: {
      requests: { updateOrganization: mocks.builtUpdateOrganization },
    },
  }),
}))

import { updateOrganization } from './organizations.update'

const ctx = { organizationId: 'org-1', userId: 'user-1', role: 'AccountAdmin' }

const update = (data: Parameters<typeof updateOrganization>[0]['data']) =>
  withStartContext(() => updateOrganization({ data }))

describe('updateOrganization server function', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ctx)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.builtUpdateOrganization.mockResolvedValue(undefined)
  })

  it('hands the input and the tenant context to the built request', async () => {
    await update({ name: 'Harborline', logo: null })

    expect(mocks.builtUpdateOrganization).toHaveBeenCalledExactlyOnceWith(
      { name: 'Harborline', logo: null },
      ctx,
    )
  })

  it('asks the execution policy before the request runs', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(new Error('execution refused'))

    await expect(update({ name: 'Harborline' })).rejects.toThrow('execution refused')

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledExactlyOnceWith({
      actor: ctx,
      action: 'organization.update',
    })
    expect(mocks.builtUpdateOrganization).not.toHaveBeenCalled()
  })

  it("maps the request's tagged refusal once, to its HTTP status", async () => {
    mocks.builtUpdateOrganization.mockRejectedValue(
      identityError('forbidden', 'Only AccountAdmin can update organization'),
    )

    await expect(update({ name: 'Harborline' })).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'forbidden',
      status: 403,
    })
  })
})
