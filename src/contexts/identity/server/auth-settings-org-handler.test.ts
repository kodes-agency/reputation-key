// The dormant createOrganizationFn: behind the blocked `organization.create`
// capability, and creating as a provider system action when that gate passes.
//
// The provider refuses every session-bound creation
// (allowUserToCreateOrganization: false). A call that handed it the caller's
// session would therefore fail the day the capability is turned on. What the
// call shape asserted here does against the real provider is proven in
// routes/api/auth/-$.integration.test.ts.

import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createOrganization: vi.fn(),
  setActiveOrganization: vi.fn(),
  requireAuth: vi.fn(),
  capabilityGateOpen: false,
}))

vi.mock('#/shared/auth/auth', () => ({
  getAuth: () => ({
    api: {
      createOrganization: mocks.createOrganization,
      setActiveOrganization: mocks.setActiveOrganization,
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers({ cookie: 'session=current' })),
}))
vi.mock('#/shared/auth/middleware', () => ({ requireAuth: mocks.requireAuth }))
// The real gate decides unless a case opens it: `organization.create` is
// beta_disabled, so no environment a deployment can set lets it through.
vi.mock('#/shared/auth/beta-capabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/shared/auth/beta-capabilities')>()
  return {
    ...actual,
    assertGlobalCapability: (
      capability: Parameters<typeof actual.assertGlobalCapability>[0],
    ) => {
      if (!mocks.capabilityGateOpen) actual.assertGlobalCapability(capability)
    },
  }
})
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import { createOrganizationFn } from './auth-settings.org'

const INPUT = { name: 'Harbour Hotel', slug: 'harbour-hotel' }

describe('createOrganizationFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.capabilityGateOpen = false
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', email: 'owner@example.test' })
    mocks.createOrganization.mockResolvedValue({ id: 'org-new', ...INPUT })
    mocks.setActiveOrganization.mockResolvedValue({ id: 'org-new' })
  })

  it('refuses behind the blocked capability before the provider is asked', async () => {
    await expect(
      withStartContext(() => createOrganizationFn({ data: INPUT })),
    ).rejects.toMatchObject({
      name: 'BetaCapabilityError',
      decision: { capability: 'organization.create', allowed: false },
    })

    expect(mocks.createOrganization).not.toHaveBeenCalled()
    expect(mocks.setActiveOrganization).not.toHaveBeenCalled()
  })

  it('creates as a system action for the signed-in user, then makes the Organization active', async () => {
    mocks.capabilityGateOpen = true

    await withStartContext(() => createOrganizationFn({ data: INPUT }))

    // Exactly this: the user by id and no `headers`. A session in the call
    // makes it session-bound, which the provider refuses.
    expect(mocks.createOrganization).toHaveBeenCalledTimes(1)
    expect(mocks.createOrganization.mock.calls[0]).toEqual([
      { body: { ...INPUT, userId: 'user-1' } },
    ])
    expect(mocks.setActiveOrganization).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: { organizationId: 'org-new' },
    })
  })
})
