// Removing an organization's logo through the server function (UI consistency scan:
// FORM-14). The update used to map a null logo to `undefined`, which Better Auth skips,
// so Remove looked saved and the logo came back on reload. The provider is now told
// `null`, and the object the logo was is freed once that is saved.
//
// The server function calls the request the Identity build publishes. The container
// here offers that request as the build wires it (`buildOrganizationSettingsUseCases`)
// over mocked ports: the provider save, the logo read and the object store.

import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const OLD = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

const mocks = vi.hoisted(() => ({
  saveOrganization: vi.fn(),
  currentOrganizationLogo: vi.fn(),
  deleteObject: vi.fn(),
  warn: vi.fn(),
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
vi.mock('#/composition', async () => {
  const { buildOrganizationSettingsUseCases } =
    await import('../build-organization-settings')
  const requests = buildOrganizationSettingsUseCases({
    saveOrganization: mocks.saveOrganization,
    assetReferences: { currentOrganizationLogo: mocks.currentOrganizationLogo },
    deleteAssetObject: mocks.deleteObject,
    logger: { warn: mocks.warn },
  })
  return { getContainer: () => ({ identityPublicApi: { requests } }) }
})

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
    mocks.saveOrganization.mockResolvedValue(undefined)
    mocks.deleteObject.mockResolvedValue(undefined)
    mocks.currentOrganizationLogo.mockResolvedValue(
      `/api/public/identity-assets/organizations/org-1/logo/${OLD}`,
    )
  })

  it('tells the provider `null`, the only value that clears the logo', async () => {
    await update({ logo: null })

    expect(mocks.saveOrganization).toHaveBeenCalledExactlyOnceWith({ logo: null })
  })

  it('frees the object the logo was, once the removal is saved', async () => {
    await update({ logo: null })

    expect(mocks.currentOrganizationLogo).toHaveBeenCalledExactlyOnceWith('org-1')
    expect(mocks.deleteObject).toHaveBeenCalledExactlyOnceWith(
      `organizations/org-1/logo/${OLD}`,
    )
  })

  it('keeps the object when the removal could not be saved', async () => {
    mocks.saveOrganization.mockRejectedValue(new Error('provider down'))

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
