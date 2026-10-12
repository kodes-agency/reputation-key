// Removing an organization's logo through the server function (UI consistency scan:
// FORM-14). The update used to map a null logo to `undefined`, which Better Auth skips,
// so Remove looked saved and the logo came back on reload. The provider is now told
// `null`, and the object the logo was is freed once that is saved.

import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const OLD = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

const mocks = vi.hoisted(() => ({
  updateOrganization: vi.fn(),
  currentOrganizationLogo: vi.fn(),
  deleteObject: vi.fn(),
  warn: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/shared/auth/auth', () => ({
  getAuth: () => ({ api: { updateOrganization: mocks.updateOrganization } }),
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
    assetStorage: { deleteObject: mocks.deleteObject },
    identityAssetReferences: {
      currentOrganizationLogo: mocks.currentOrganizationLogo,
    },
    logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn() },
  }),
}))

import { updateOrganization } from './organizations.update'

const update = (data: Parameters<typeof updateOrganization>[0]['data']) =>
  withStartContext(() => updateOrganization({ data }))

describe('updateOrganization removing the logo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue({
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'AccountAdmin',
    })
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.updateOrganization.mockResolvedValue({})
    mocks.deleteObject.mockResolvedValue(undefined)
    mocks.currentOrganizationLogo.mockResolvedValue(
      `/api/public/identity-assets/organizations/org-1/logo/${OLD}`,
    )
  })

  it('tells the provider `null`, the only value that clears the logo', async () => {
    await update({ logo: null })

    expect(mocks.updateOrganization).toHaveBeenCalledOnce()
    const call = mocks.updateOrganization.mock.calls[0]?.[0]
    expect(call.body.data.logo).toBeNull()
  })

  it('frees the object the logo was, once the removal is saved', async () => {
    await update({ logo: null })

    expect(mocks.deleteObject).toHaveBeenCalledExactlyOnceWith(
      `organizations/org-1/logo/${OLD}`,
    )
  })

  it('keeps the object when the removal could not be saved', async () => {
    mocks.updateOrganization.mockRejectedValue(new Error('provider down'))

    await expect(update({ logo: null })).rejects.toBeDefined()

    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })

  it('never deletes another organization’s object', async () => {
    mocks.currentOrganizationLogo.mockResolvedValue(
      `/api/public/identity-assets/organizations/org-2/logo/${OLD}`,
    )

    await update({ logo: null })

    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })

  it('leaves the logo and the store alone for an update that does not mention it', async () => {
    await update({ name: 'Renamed' })

    expect(mocks.currentOrganizationLogo).not.toHaveBeenCalled()
    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })
})
