import { describe, it, expect, beforeEach } from 'vitest'
import { setPermissionLookup } from '#/shared/domain/permissions'
import { finalizeOrgLogoUpload } from './finalize-org-logo-upload'
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

describe('finalizeOrgLogoUpload', () => {
  beforeEach(() => {
    setPermissionLookup(() => true)
  })

  it('rejects Staff role with forbidden error', async () => {
    setPermissionLookup(() => false)

    const useCase = finalizeOrgLogoUpload({ storage: mockStorage })

    try {
      await useCase(
        { key: `organizations/${memberCtx.organizationId}/logo/test.png` },
        memberCtx,
      )
      expect.unreachable('Should have thrown')
    } catch (e: unknown) {
      expect(e).toMatchObject({
        _tag: 'IdentityError',
        code: 'forbidden',
        message: 'Insufficient permissions to finalize organization logo upload',
      })
    }
  })

  it('allows AccountAdmin role past auth guard', async () => {
    setPermissionLookup(() => true)

    const useCase = finalizeOrgLogoUpload({ storage: mockStorage })
    const result = await useCase(
      { key: `organizations/${adminCtx.organizationId}/logo/logo.png` },
      adminCtx,
    )

    expect(result).toHaveProperty('logoUrl')
  })
})
