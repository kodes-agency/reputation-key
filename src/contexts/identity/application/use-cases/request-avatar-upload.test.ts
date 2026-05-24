import { describe, it, expect, beforeEach } from 'vitest'
import { setPermissionLookup } from '#/shared/domain/permissions'
import { requestAvatarUpload } from './request-avatar-upload'
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

describe('requestAvatarUpload', () => {
  beforeEach(() => {
    setPermissionLookup(() => true)
  })

  it('rejects Staff role with forbidden error', async () => {
    setPermissionLookup(() => false)

    const useCase = requestAvatarUpload({
      storage: mockStorage,
      idGen: () => 'random-id',
    })

    try {
      await useCase({ contentType: 'image/png', fileSize: 1024 }, memberCtx)
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

    const useCase = requestAvatarUpload({
      storage: mockStorage,
      idGen: () => 'random-id',
    })

    const result = await useCase({ contentType: 'image/png', fileSize: 1024 }, adminCtx)

    expect(result).toHaveProperty('uploadUrl')
    expect(result).toHaveProperty('key')
  })
})
