import { describe, it, expect, beforeEach } from 'vitest'
import { initPermissionTable } from '#/shared/auth/permissions'
import { setPermissionLookup } from '#/shared/domain/permissions'
import { requestOrgLogoUpload } from './request-org-logo-upload'
import { organizationId, userId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'

// ── Helpers ──────────────────────────────────────────────────────────

const memberCtx: AuthContext = {
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  role: 'Member',
}

const managerCtx: AuthContext = {
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  role: 'PropertyManager',
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
  confirmUpload: async () => {},
  deleteObject: async () => {},
  getObject: async () => null,
  putObject: async () => {},
}

// ── Tests ────────────────────────────────────────────────────────────

describe('requestOrgLogoUpload', () => {
  beforeEach(() => {
    setPermissionLookup(() => true)
  })

  it('rejects Member role with forbidden error', async () => {
    setPermissionLookup(() => false)

    const useCase = requestOrgLogoUpload({
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
        message: 'Insufficient permissions to upload organization logo',
      })
    }
  })

  it('rejects PropertyManager, and mints no upload URL', async () => {
    // The logo is an Organization setting (ADR 0033): run the real role table.
    initPermissionTable()
    let presigned = 0
    const useCase = requestOrgLogoUpload({
      storage: {
        ...mockStorage,
        createPresignedUploadUrl: async () => {
          presigned += 1
          return { uploadUrl: 'https://example.com/upload', key: 'test' }
        },
      },
      idGen: () => 'random-id',
    })

    await expect(
      useCase({ contentType: 'image/png', fileSize: 1024 }, managerCtx),
    ).rejects.toMatchObject({
      _tag: 'IdentityError',
      code: 'forbidden',
      message: 'Insufficient permissions to upload organization logo',
    })
    expect(presigned).toBe(0)
  })

  it('allows AccountAdmin role past auth guard', async () => {
    setPermissionLookup(() => true)

    const useCase = requestOrgLogoUpload({
      storage: mockStorage,
      idGen: () => 'random-id',
    })

    const result = await useCase({ contentType: 'image/png', fileSize: 1024 }, adminCtx)

    expect(result).toHaveProperty('uploadUrl')
    expect(result).toHaveProperty('key')
  })
})
