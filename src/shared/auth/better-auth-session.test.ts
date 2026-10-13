// The Better Auth session adapter is how every Organization update is saved.
// The provider must be called as the signed-in caller, with the changed fields
// under `body.data`, the shape its update endpoint reads.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ updateOrganization: vi.fn() }))

vi.mock('./auth', () => ({
  getAuth: () => ({ api: { updateOrganization: mocks.updateOrganization } }),
}))

import { createBetterAuthSessionPort } from './better-auth-session'

describe('Better Auth session adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateOrganization.mockResolvedValue({})
  })

  it('saves an Organization update with the request headers and the fields under body.data', async () => {
    const headers = new Headers({ cookie: 'session=current' })
    const session = createBetterAuthSessionPort({
      requestContext: { currentRequestHeaders: async () => headers },
    })

    await session.updateOrganization({ name: 'Harbour Hotels', logo: null })

    expect(mocks.updateOrganization).toHaveBeenCalledExactlyOnceWith({
      headers,
      body: { data: { name: 'Harbour Hotels', logo: null } },
    })
  })

  it('lets a refused save reach the caller', async () => {
    mocks.updateOrganization.mockRejectedValue(new Error('provider refused the update'))
    const session = createBetterAuthSessionPort({
      requestContext: { currentRequestHeaders: async () => new Headers() },
    })

    await expect(session.updateOrganization({ name: 'Harbour Hotels' })).rejects.toThrow(
      'provider refused the update',
    )
  })
})
