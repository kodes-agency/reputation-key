import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setPermissionLookup } from '#/shared/domain/permissions'
import { finalizeAvatarUpload } from './finalize-avatar-upload'
import { identityAssetPath } from '../identity-assets'
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

  it('confirms the object it names, and nothing else', async () => {
    const confirmUpload = vi.fn(async () => {})
    const useCase = finalizeAvatarUpload({
      storage: { ...mockStorage, confirmUpload },
    })

    await useCase({ key: `avatars/${adminCtx.userId}/${ASSET}` }, adminCtx)

    expect(confirmUpload).toHaveBeenCalledWith(`avatars/${adminCtx.userId}/${ASSET}`)
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
        confirmUpload: async () => {
          throw new Error('NotFound')
        },
      },
    })

    await expect(
      useCase({ key: `avatars/${adminCtx.userId}/${ASSET}` }, adminCtx),
    ).rejects.toThrow('NotFound')
  })
})
