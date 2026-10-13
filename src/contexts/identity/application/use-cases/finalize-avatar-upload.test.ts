import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setPermissionLookup } from '#/shared/domain/permissions'
import { finalizeAvatarUpload } from './finalize-avatar-upload'
import { identityAssetPath } from '../identity-assets'
import { MAX_UPLOAD_BYTES } from '../upload-policy'
import { organizationId, userId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'

// ── Helpers ──────────────────────────────────────────────────────────

const memberCtx: AuthContext = {
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  role: 'Member',
}

const adminCtx: AuthContext = {
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  role: 'AccountAdmin',
}

const ASSET = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

const mockStorage = {
  createPresignedUploadUrl: async () => ({
    uploadUrl: 'https://example.com/upload',
    key: 'test',
  }),
  confirmUpload: async () => {},
  inspectObject: async () => ({ contentType: 'image/png', sizeBytes: 1024 }),
  deleteObject: async () => {},
  getObject: async () => null,
  putObject: async () => {},
}

// ── Tests ────────────────────────────────────────────────────────────

describe('finalizeAvatarUpload', () => {
  beforeEach(() => {
    // Reset to real permissions before each test
    setPermissionLookup(() => true)
  })

  it('rejects Member role with forbidden error', async () => {
    setPermissionLookup(() => false)

    const useCase = finalizeAvatarUpload({ storage: mockStorage })

    try {
      await useCase({ key: `avatars/${memberCtx.userId}/${ASSET}` }, memberCtx)
      expect.unreachable('Should have thrown')
    } catch (e: unknown) {
      expect(e).toMatchObject({
        _tag: 'IdentityError',
        code: 'forbidden',
        message: 'Insufficient permissions to upload avatar',
      })
    }
  })

  it('allows AccountAdmin role past auth guard', async () => {
    setPermissionLookup(() => true)

    const useCase = finalizeAvatarUpload({ storage: mockStorage })
    const result = await useCase({ key: `avatars/${adminCtx.userId}/${ASSET}` }, adminCtx)

    expect(result).toHaveProperty('avatarUrl')
  })

  it('returns a path on the app, never a provider or AWS URL or a host', async () => {
    const useCase = finalizeAvatarUpload({ storage: mockStorage })

    const { avatarUrl } = await useCase(
      { key: `avatars/${adminCtx.userId}/${ASSET}` },
      adminCtx,
    )

    expect(avatarUrl).toBe(`/api/public/identity-assets/avatars/user-1/${ASSET}`)
    expect(avatarUrl).toBe(identityAssetPath(`avatars/user-1/${ASSET}`))
    expect(avatarUrl).not.toContain('amazonaws')
  })

  it('reads the stored object it names, and nothing else', async () => {
    const inspectObject = vi.fn(async () => ({
      contentType: 'image/png',
      sizeBytes: 1024,
    }))
    const useCase = finalizeAvatarUpload({
      storage: { ...mockStorage, inspectObject },
    })

    await useCase({ key: `avatars/${adminCtx.userId}/${ASSET}` }, adminCtx)

    expect(inspectObject).toHaveBeenCalledWith(`avatars/${adminCtx.userId}/${ASSET}`)
  })

  // The 5 MB rule was only ever checked against the size the browser declared
  // when it asked for the upload address; the address itself carries no bound.
  it('refuses a stored object over the cap, whatever size was declared, and removes it', async () => {
    const key = `avatars/${adminCtx.userId}/${ASSET}`
    const deleteObject = vi.fn(async () => {})
    const useCase = finalizeAvatarUpload({
      storage: {
        ...mockStorage,
        inspectObject: async () => ({
          contentType: 'image/png',
          sizeBytes: MAX_UPLOAD_BYTES + 1,
        }),
        deleteObject,
      },
    })

    await expect(useCase({ key }, adminCtx)).rejects.toMatchObject({
      _tag: 'IdentityError',
      code: 'validation_error',
      message: 'File size exceeds 5 MB limit',
    })
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith(key)
  })

  it('accepts a stored object exactly at the cap and removes nothing', async () => {
    const deleteObject = vi.fn(async () => {})
    const useCase = finalizeAvatarUpload({
      storage: {
        ...mockStorage,
        inspectObject: async () => ({
          contentType: 'image/png',
          sizeBytes: MAX_UPLOAD_BYTES,
        }),
        deleteObject,
      },
    })

    const result = await useCase({ key: `avatars/${adminCtx.userId}/${ASSET}` }, adminCtx)

    expect(result.avatarUrl).toBe(`/api/public/identity-assets/avatars/user-1/${ASSET}`)
    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('refuses a stored object whose size the store does not report, and removes it', async () => {
    const key = `avatars/${adminCtx.userId}/${ASSET}`
    const deleteObject = vi.fn(async () => {})
    const useCase = finalizeAvatarUpload({
      storage: {
        ...mockStorage,
        inspectObject: async () => ({ contentType: 'image/png', sizeBytes: null }),
        deleteObject,
      },
    })

    await expect(useCase({ key }, adminCtx)).rejects.toMatchObject({
      code: 'validation_error',
      message: 'The uploaded file could not be checked. Upload it again.',
    })
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith(key)
  })

  it('refuses a key under another user', async () => {
    const useCase = finalizeAvatarUpload({ storage: mockStorage })

    await expect(
      useCase({ key: `avatars/someone-else/${ASSET}` }, adminCtx),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a key the image route could not serve, so no dead address is stored', async () => {
    const useCase = finalizeAvatarUpload({ storage: mockStorage })

    await expect(
      useCase({ key: `avatars/${adminCtx.userId}/${ASSET}/extra` }, adminCtx),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('returns no address when the upload never arrived', async () => {
    const useCase = finalizeAvatarUpload({
      storage: {
        ...mockStorage,
        inspectObject: async () => {
          throw new Error('NotFound')
        },
      },
    })

    await expect(
      useCase({ key: `avatars/${adminCtx.userId}/${ASSET}` }, adminCtx),
    ).rejects.toThrow('NotFound')
  })
})
