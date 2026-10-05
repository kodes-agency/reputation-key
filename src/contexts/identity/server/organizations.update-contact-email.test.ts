// Clearing an organization's contact email through the server function. The settings
// form sends an empty string for a cleared field, which the server function reads as
// `null`. The patch used to map that `null` to `undefined`, which Better Auth skips on
// update, so the Organization page said saved and the email came back on reload. The
// provider is now told `null`, the only value that clears the column.

import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateOrganization: vi.fn(),
  currentOrganizationLogo: vi.fn(),
  deleteObject: vi.fn(),
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
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  }),
}))

import { updateOrganization, updateOrganizationInputSchema } from './organizations.update'

/**
 * Calls the server function with `raw` as the page would send it: the input schema
 * reads it first, as the framework does before the handler runs (a handler called
 * directly in a test is not validated).
 */
const update = (raw: Parameters<typeof updateOrganizationInputSchema.parse>[0]) =>
  withStartContext(() =>
    updateOrganization({ data: updateOrganizationInputSchema.parse(raw) }),
  )

/** The `data` the provider was asked to save. */
const savedData = (): Record<string, unknown> =>
  mocks.updateOrganization.mock.calls[0]?.[0].body.data

describe('updateOrganization clearing the contact email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue({
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'AccountAdmin',
    })
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.updateOrganization.mockResolvedValue({})
  })

  it('tells the provider `null` for the empty string a cleared field sends', async () => {
    await update({ name: 'Harborline', contactEmail: '' })

    expect(mocks.updateOrganization).toHaveBeenCalledOnce()
    expect(savedData().contactEmail).toBeNull()
  })

  it('tells the provider `null` for an explicit null', async () => {
    await update({ contactEmail: null })

    expect(savedData().contactEmail).toBeNull()
  })

  it('saves an address as it was typed', async () => {
    await update({ contactEmail: 'ops@harborline.example' })

    expect(savedData().contactEmail).toBe('ops@harborline.example')
  })

  it('leaves the contact email alone for an update that does not mention it', async () => {
    await update({ name: 'Renamed' })

    expect(savedData()).not.toHaveProperty('contactEmail')
  })

  it('does not touch the logo or the store: only a removed logo frees an object', async () => {
    await update({ contactEmail: '' })

    expect(mocks.currentOrganizationLogo).not.toHaveBeenCalled()
    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })

  it('refuses a malformed address before anything is saved', async () => {
    await expect(async () => update({ contactEmail: 'not-an-email' })).rejects.toThrow(
      /invalid email/iu,
    )

    expect(mocks.updateOrganization).not.toHaveBeenCalled()
  })
})
