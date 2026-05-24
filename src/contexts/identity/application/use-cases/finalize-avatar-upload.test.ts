import { describe, it, expect, beforeEach } from 'vitest'
import { setPermissionLookup } from '#/shared/domain/permissions'
import { finalizeAvatarUpload } from './finalize-avatar-upload'
import { organizationId, userId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'

// ── Helpers ──────────────────────────────────────────────────────────

const memberCtx: AuthContext = {
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  role: 'Staff',
}

const adminCtx: AuthContext = {
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  role: 'AccountAdmin',
}

const mockStorage = {
  createPresignedUploadUrl: async () => ({
    uploadUrl: 'https://example.com/upload',
    key: 'test',
  }),
  confirmUpload: async (key: string) => `https://cdn.example.com/${key}`,
  deleteObject: async () => {},
  getPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
  putObject: async () => {},
}

// ── Tests ────────────────────────────────────────────────────────────

describe('finalizeAvatarUpload', () => {
  beforeEach(() => {
    // Reset to real permissions before each test
    setPermissionLookup(() => true)
  })

  it('rejects Staff role with forbidden error', async () => {
    setPermissionLookup(() => false)

    const useCase = finalizeAvatarUpload({ storage: mockStorage })

    try {
      await useCase({ key: `avatars/${memberCtx.userId}/test.png` }, memberCtx)
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
    const result = await useCase(
      { key: `avatars/${adminCtx.userId}/photo.png` },
      adminCtx,
    )

    expect(result).toHaveProperty('avatarUrl')
  })
})
