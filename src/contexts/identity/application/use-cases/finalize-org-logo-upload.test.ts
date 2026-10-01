import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setPermissionLookup } from '#/shared/domain/permissions'
import { finalizeOrgLogoUpload } from './finalize-org-logo-upload'
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

const mockUpdateOrg = vi.fn().mockResolvedValue(undefined)

const setup = () => ({
  useCase: finalizeOrgLogoUpload({
    storage: mockStorage,
    assetUrl,
    updateOrg: mockUpdateOrg,
  }),
  updateOrg: mockUpdateOrg,
})

// ── Tests ────────────────────────────────────────────────────────────

describe('finalizeOrgLogoUpload', () => {
  beforeEach(() => {
    setPermissionLookup(() => true)
  })

  it('rejects Member role with forbidden error', async () => {
    setPermissionLookup(() => false)

    const useCase = finalizeOrgLogoUpload({
      storage: mockStorage,
      assetUrl,
      updateOrg: mockUpdateOrg,
    })

    try {
      await useCase(
        { key: `organizations/${memberCtx.organizationId}/logo/${ASSET}` },
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

    const { useCase, updateOrg } = setup()
    const result = await useCase(
      { key: `organizations/${adminCtx.organizationId}/logo/${ASSET}` },
      adminCtx,
    )

    expect(result).toHaveProperty('logoUrl')
    // The use case now owns logo persistence — verify it delegated to updateOrg.
    expect(updateOrg).toHaveBeenCalledWith({ logo: result.logoUrl })
  })

  it('stores an address on the app, never a provider or AWS URL', async () => {
    const { useCase, updateOrg } = setup()
    updateOrg.mockClear()

    const { logoUrl } = await useCase(
      { key: `organizations/${adminCtx.organizationId}/logo/${ASSET}` },
      adminCtx,
    )

    const expected = `https://app.example.com/api/public/identity-assets/organizations/org-1/logo/${ASSET}`
    expect(logoUrl).toBe(expected)
    expect(updateOrg).toHaveBeenCalledWith({ logo: expected })
  })

  it('refuses a key under another organization, and stores nothing', async () => {
    const { useCase, updateOrg } = setup()
    updateOrg.mockClear()

    await expect(
      useCase({ key: `organizations/other-org/logo/${ASSET}` }, adminCtx),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(updateOrg).not.toHaveBeenCalled()
  })

  it('refuses a key the image route could not serve, and stores nothing', async () => {
    const { useCase, updateOrg } = setup()
    updateOrg.mockClear()

    await expect(
      useCase({ key: `organizations/${adminCtx.organizationId}/logo/x.png` }, adminCtx),
    ).rejects.toMatchObject({ code: 'validation_error' })
    expect(updateOrg).not.toHaveBeenCalled()
  })

  it('stores nothing when the upload never arrived', async () => {
    const updateOrg = vi.fn().mockResolvedValue(undefined)
    const useCase = finalizeOrgLogoUpload({
      storage: {
        ...mockStorage,
        confirmUpload: async () => {
          throw new Error('NotFound')
        },
      },
      assetUrl,
      updateOrg,
    })

    await expect(
      useCase(
        { key: `organizations/${adminCtx.organizationId}/logo/${ASSET}` },
        adminCtx,
      ),
    ).rejects.toThrow('NotFound')
    expect(updateOrg).not.toHaveBeenCalled()
  })
})
