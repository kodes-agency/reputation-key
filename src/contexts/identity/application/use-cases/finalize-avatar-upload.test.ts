import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setPermissionLookup } from '#/shared/domain/permissions'
import { finalizeAvatarUpload } from './finalize-avatar-upload'
import { identityAssetUrl } from '../identity-assets'
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
const assetUrl = (key: string) => identityAssetUrl('https://app.example.com', key)

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

    const useCase = finalizeAvatarUpload({ storage: mockStorage, assetUrl })

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

    const useCase = finalizeAvatarUpload({ storage: mockStorage, assetUrl })
    const result = await useCase({ key: `avatars/${adminCtx.userId}/${ASSET}` }, adminCtx)

    expect(result).toHaveProperty('avatarUrl')
  })

  it('returns an address on the app, never a provider or AWS URL', async () => {
    const useCase = finalizeAvatarUpload({ storage: mockStorage, assetUrl })

    const { avatarUrl } = await useCase(
      { key: `avatars/${adminCtx.userId}/${ASSET}` },
      adminCtx,
    )

    expect(avatarUrl).toBe(
      `https://app.example.com/api/public/identity-assets/avatars/user-1/${ASSET}`,
    )
    expect(avatarUrl).not.toContain('amazonaws')
  })

  it('confirms the object it names, and nothing else', async () => {
    const confirmUpload = vi.fn(async () => {})
    const useCase = finalizeAvatarUpload({
      storage: { ...mockStorage, confirmUpload },
      assetUrl,
    })

    await useCase({ key: `avatars/${adminCtx.userId}/${ASSET}` }, adminCtx)

    expect(confirmUpload).toHaveBeenCalledWith(`avatars/${adminCtx.userId}/${ASSET}`)
  })

  it('refuses a key under another user', async () => {
    const useCase = finalizeAvatarUpload({ storage: mockStorage, assetUrl })

    await expect(
      useCase({ key: `avatars/someone-else/${ASSET}` }, adminCtx),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a key the image route could not serve, so no dead address is stored', async () => {
    const useCase = finalizeAvatarUpload({ storage: mockStorage, assetUrl })

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
      assetUrl,
    })

    await expect(
      useCase({ key: `avatars/${adminCtx.userId}/${ASSET}` }, adminCtx),
    ).rejects.toThrow('NotFound')
  })
})
