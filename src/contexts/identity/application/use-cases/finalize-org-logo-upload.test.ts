import { describe, it, expect, beforeEach, vi } from 'vitest'
import { initPermissionTable } from '#/shared/auth/permissions'
import { setPermissionLookup } from '#/shared/domain/permissions'
import { finalizeOrgLogoUpload } from './finalize-org-logo-upload'
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

const ASSET = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const OLD_ASSET = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

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

const mockUpdateOrg = vi.fn().mockResolvedValue(undefined)
const mockRetire = vi.fn().mockResolvedValue(undefined)

const deps = (overrides: Partial<Parameters<typeof finalizeOrgLogoUpload>[0]> = {}) => ({
  storage: mockStorage,
  currentLogo: async () => null,
  retireReplaced: mockRetire,
  updateOrg: mockUpdateOrg,
  ...overrides,
})

const setup = () => ({
  useCase: finalizeOrgLogoUpload(deps()),
  updateOrg: mockUpdateOrg,
})

// ── Tests ────────────────────────────────────────────────────────────

describe('finalizeOrgLogoUpload', () => {
  beforeEach(() => {
    setPermissionLookup(() => true)
  })

  it('rejects Member role with forbidden error', async () => {
    setPermissionLookup(() => false)

    const useCase = finalizeOrgLogoUpload(deps())

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

  it('rejects PropertyManager, reading no upload and persisting no logo', async () => {
    // The logo is an Organization setting (ADR 0033): run the real role table.
    initPermissionTable()
    const inspectObject = vi.fn(async (_key: string) => ({
      contentType: 'image/png',
      sizeBytes: 1024,
    }))
    const updateOrg = vi.fn().mockResolvedValue(undefined)
    const useCase = finalizeOrgLogoUpload(
      deps({ storage: { ...mockStorage, inspectObject }, updateOrg }),
    )

    await expect(
      useCase(
        { key: `organizations/${managerCtx.organizationId}/logo/test.png` },
        managerCtx,
      ),
    ).rejects.toMatchObject({
      _tag: 'IdentityError',
      code: 'forbidden',
      message: 'Insufficient permissions to finalize organization logo upload',
    })
    // The refusal comes before the object is read, so none is removed either.
    expect(inspectObject).not.toHaveBeenCalled()
    expect(updateOrg).not.toHaveBeenCalled()
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

  it('stores a path on the app, never a provider or AWS URL or a host', async () => {
    const { useCase, updateOrg } = setup()
    updateOrg.mockClear()

    const { logoUrl } = await useCase(
      { key: `organizations/${adminCtx.organizationId}/logo/${ASSET}` },
      adminCtx,
    )

    const expected = `/api/public/identity-assets/organizations/org-1/logo/${ASSET}`
    expect(expected).toBe(identityAssetPath(`organizations/org-1/logo/${ASSET}`))
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
    const useCase = finalizeOrgLogoUpload(
      deps({
        storage: {
          ...mockStorage,
          inspectObject: async () => {
            throw new Error('NotFound')
          },
        },
        updateOrg,
      }),
    )

    await expect(
      useCase(
        { key: `organizations/${adminCtx.organizationId}/logo/${ASSET}` },
        adminCtx,
      ),
    ).rejects.toThrow('NotFound')
    expect(updateOrg).not.toHaveBeenCalled()
  })

  // The 5 MB rule was only ever checked against the size the browser declared
  // when it asked for the upload address; the address itself carries no bound.
  it('refuses a stored object over the cap, removes it, and stores no logo', async () => {
    const key = `organizations/${adminCtx.organizationId}/logo/${ASSET}`
    const deleteObject = vi.fn(async () => {})
    const updateOrg = vi.fn().mockResolvedValue(undefined)
    const retireReplaced = vi.fn().mockResolvedValue(undefined)
    const useCase = finalizeOrgLogoUpload(
      deps({
        storage: {
          ...mockStorage,
          inspectObject: async () => ({
            contentType: 'image/png',
            sizeBytes: MAX_UPLOAD_BYTES + 1,
          }),
          deleteObject,
        },
        updateOrg,
        retireReplaced,
      }),
    )

    await expect(useCase({ key }, adminCtx)).rejects.toMatchObject({
      _tag: 'IdentityError',
      code: 'validation_error',
      message: 'File size exceeds 5 MB limit',
    })
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith(key)
    expect(updateOrg).not.toHaveBeenCalled()
    // The logo in use is untouched: only the refused upload is removed.
    expect(retireReplaced).not.toHaveBeenCalled()
  })

  it('frees the logo it replaces, after the new one is saved', async () => {
    const order: string[] = []
    const previous = identityAssetPath(`organizations/org-1/logo/${OLD_ASSET}`)
    const useCase = finalizeOrgLogoUpload(
      deps({
        currentLogo: async () => previous,
        updateOrg: async () => {
          order.push('saved')
        },
        retireReplaced: async (input) => {
          order.push('retired')
          expect(input).toEqual({
            previous,
            nextKey: `organizations/org-1/logo/${ASSET}`,
            kind: 'logo',
            ownerId: 'org-1',
          })
        },
      }),
    )

    await useCase({ key: `organizations/org-1/logo/${ASSET}` }, adminCtx)

    expect(order).toEqual(['saved', 'retired'])
  })

  it('keeps the old logo when saving the new one fails', async () => {
    const retireReplaced = vi.fn()
    const useCase = finalizeOrgLogoUpload(
      deps({
        currentLogo: async () =>
          identityAssetPath(`organizations/org-1/logo/${OLD_ASSET}`),
        updateOrg: async () => {
          throw new Error('provider down')
        },
        retireReplaced,
      }),
    )

    await expect(
      useCase({ key: `organizations/org-1/logo/${ASSET}` }, adminCtx),
    ).rejects.toThrow('provider down')
    expect(retireReplaced).not.toHaveBeenCalled()
  })
})
