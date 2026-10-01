// Saving a new avatar: the image is stored, the one it replaces is freed, and a
// path on the app is a valid address while a foreign object never is deleted.

import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const OLD = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const NEW = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
  currentUserImage: vi.fn(),
  deleteObject: vi.fn(),
  warn: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/shared/auth/auth', () => ({
  getAuth: () => ({ api: { updateUser: mocks.updateUser } }),
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
    identityAssetReferences: { currentUserImage: mocks.currentUserImage },
    logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn() },
  }),
}))

import { updateUserImageFn } from './auth-settings'

const save = (imageUrl: string) =>
  withStartContext(() => updateUserImageFn({ data: { imageUrl } }))

describe('updateUserImageFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue({
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'AccountAdmin',
    })
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.updateUser.mockResolvedValue({ status: true })
    mocks.deleteObject.mockResolvedValue(undefined)
  })

  it('accepts the path an uploaded avatar is stored at, and frees the one it replaces', async () => {
    mocks.currentUserImage.mockResolvedValue(
      `/api/public/identity-assets/avatars/user-1/${OLD}`,
    )

    await save(`/api/public/identity-assets/avatars/user-1/${NEW}`)

    expect(mocks.updateUser).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: { image: `/api/public/identity-assets/avatars/user-1/${NEW}` },
    })
    expect(mocks.deleteObject).toHaveBeenCalledExactlyOnceWith(`avatars/user-1/${OLD}`)
  })

  it('keeps the old object when the new image could not be saved', async () => {
    mocks.currentUserImage.mockResolvedValue(
      `/api/public/identity-assets/avatars/user-1/${OLD}`,
    )
    mocks.updateUser.mockRejectedValue(
      Object.assign(new Error('nope'), { statusCode: 500 }),
    )

    await expect(
      save(`/api/public/identity-assets/avatars/user-1/${NEW}`),
    ).rejects.toBeDefined()

    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })

  it('never deletes another user’s object, even if that is what was stored', async () => {
    mocks.currentUserImage.mockResolvedValue(
      `/api/public/identity-assets/avatars/someone-else/${OLD}`,
    )

    await save(`/api/public/identity-assets/avatars/user-1/${NEW}`)

    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })

  it('still accepts an image hosted elsewhere, and deletes nothing for it', async () => {
    mocks.currentUserImage.mockResolvedValue(
      `/api/public/identity-assets/avatars/user-1/${OLD}`,
    )

    await save('https://cdn.example.com/me.png')

    expect(mocks.updateUser).toHaveBeenCalledOnce()
    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })
})
