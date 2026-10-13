// Saving a new avatar: the image is stored, the one it replaces is freed, and a
// path on the app is a valid address while a foreign object never is deleted.
// The address of an uploaded avatar is saved only for the member's own object,
// and only after its stored size has been read.

import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_UPLOAD_BYTES } from '../application/upload-policy'

const OLD = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const NEW = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
  currentUserImage: vi.fn(),
  inspectObject: vi.fn(),
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
    assetStorage: {
      inspectObject: mocks.inspectObject,
      deleteObject: mocks.deleteObject,
    },
    identityAssetReferences: { currentUserImage: mocks.currentUserImage },
    logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn() },
  }),
}))

import { updateUserImageFn } from './auth-settings'

const save = (imageUrl: string | null) =>
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
    mocks.inspectObject.mockResolvedValue({ contentType: 'image/png', sizeBytes: 1024 })
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
    ).rejects.toMatchObject({ name: 'InternalError', status: 500 })

    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })

  // The finalize step reads the stored size, but nothing makes a caller run it:
  // a member could ask for an upload address declaring one byte, send any size
  // and call this function with the path. The save is the step that cannot be
  // skipped, so the size is read here too.
  it('refuses an uploaded avatar the store holds over the cap, removes it, and saves nothing', async () => {
    mocks.currentUserImage.mockResolvedValue(
      `/api/public/identity-assets/avatars/user-1/${OLD}`,
    )
    mocks.inspectObject.mockResolvedValue({
      contentType: 'image/png',
      sizeBytes: MAX_UPLOAD_BYTES + 1,
    })

    await expect(
      save(`/api/public/identity-assets/avatars/user-1/${NEW}`),
    ).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'validation_error',
      status: 400,
      message: 'File size exceeds 5 MB limit',
    })

    expect(mocks.inspectObject).toHaveBeenCalledExactlyOnceWith(`avatars/user-1/${NEW}`)
    expect(mocks.deleteObject).toHaveBeenCalledExactlyOnceWith(`avatars/user-1/${NEW}`)
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('saves nothing when the upload never arrived or the store cannot be read', async () => {
    mocks.currentUserImage.mockResolvedValue(null)
    mocks.inspectObject.mockRejectedValue(new Error('NotFound'))

    await expect(
      save(`/api/public/identity-assets/avatars/user-1/${NEW}`),
    ).rejects.toMatchObject({ name: 'InternalError', status: 500 })

    expect(mocks.updateUser).not.toHaveBeenCalled()
    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })

  // The schema accepts any user's avatar path, and the size check deletes what
  // it refuses, so the key is held to the caller before the store is touched.
  it('refuses another user’s avatar path without reading or deleting their object', async () => {
    mocks.currentUserImage.mockResolvedValue(null)
    mocks.inspectObject.mockResolvedValue({
      contentType: 'image/png',
      sizeBytes: MAX_UPLOAD_BYTES + 1,
    })

    await expect(
      save(`/api/public/identity-assets/avatars/someone-else/${NEW}`),
    ).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'forbidden',
      status: 403,
    })

    expect(mocks.inspectObject).not.toHaveBeenCalled()
    expect(mocks.deleteObject).not.toHaveBeenCalled()
    expect(mocks.updateUser).not.toHaveBeenCalled()
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
    expect(mocks.inspectObject).not.toHaveBeenCalled()
    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })

  // Remove is the same call with no image (UI consistency scan: FORM-14). It used to be
  // refused by the schema, so the page only cleared what it showed and the avatar came
  // back on reload.
  it('removes the avatar: saves no image and frees the object it was', async () => {
    mocks.currentUserImage.mockResolvedValue(
      `/api/public/identity-assets/avatars/user-1/${OLD}`,
    )

    await save(null)

    expect(mocks.updateUser).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: { image: null },
    })
    expect(mocks.inspectObject).not.toHaveBeenCalled()
    expect(mocks.deleteObject).toHaveBeenCalledExactlyOnceWith(`avatars/user-1/${OLD}`)
  })

  it('keeps the object when the removal could not be saved', async () => {
    mocks.currentUserImage.mockResolvedValue(
      `/api/public/identity-assets/avatars/user-1/${OLD}`,
    )
    mocks.updateUser.mockRejectedValue(
      Object.assign(new Error('nope'), { statusCode: 500 }),
    )

    await expect(save(null)).rejects.toMatchObject({ name: 'InternalError', status: 500 })

    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })

  it('removes an avatar hosted elsewhere without deleting anything', async () => {
    mocks.currentUserImage.mockResolvedValue('https://cdn.example.com/me.png')

    await save(null)

    expect(mocks.updateUser).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: { image: null },
    })
    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })
})
