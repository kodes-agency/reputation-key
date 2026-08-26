import { describe, expect, it, vi } from 'vitest'
import { requestUploadUrl } from './request-upload-url'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalUploadIssuanceStore } from '#/shared/testing/in-memory-portal-upload-issuance-store'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { propertyId, type PropertyId } from '#/shared/domain/ids'
import type { IssuedPortalUploadStoragePort } from '../ports/storage.port'

const ISSUANCE_ID = '70000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-08-26T12:00:00.000Z')

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const portalRepo = createInMemoryPortalRepo()
  const uploadStore = createInMemoryPortalUploadIssuanceStore()
  const storage = {
    createIssuedPortalUpload: async () => ({
      uploadUrl: 'https://r2.example.com/presigned',
    }),
  } satisfies Pick<IssuedPortalUploadStoragePort, 'createIssuedPortalUpload'>
  const useCase = requestUploadUrl({
    portalRepo,
    uploadStore,
    storage,
    staffPublicApi: staffApiMock(accessible),
    idGen: () => ISSUANCE_ID,
    clock: () => NOW,
  })
  return { useCase, portalRepo, uploadStore, storage }
}

describe('requestUploadUrl', () => {
  it('issues one opaque, scope-bound hero upload without returning its object key', async () => {
    const { useCase, portalRepo, uploadStore } = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    const result = await useCase(
      { portalId: portal.id, contentType: 'image/png', fileSize: 1024 },
      ctx,
    )

    expect(result).toEqual({
      uploadUrl: 'https://r2.example.com/presigned',
      uploadId: ISSUANCE_ID,
      expiresAt: '2026-08-26T12:15:00.000Z',
      contentType: 'image/png',
      maxSizeBytes: 10 * 1024 * 1024,
    })
    expect(result).not.toHaveProperty('key')
    expect(uploadStore.all()).toEqual([
      expect.objectContaining({
        id: ISSUANCE_ID,
        organizationId: ctx.organizationId,
        propertyId: portal.propertyId,
        portalId: portal.id,
        purpose: 'hero_image',
        objectKey: `private/portal-uploads/${ISSUANCE_ID}/source.png`,
        contentType: 'image/png',
        declaredSizeBytes: 1024,
        state: 'issued',
      }),
    ])
  })

  it.each([
    ['application/pdf', 1024],
    ['image/gif', 1024],
    ['image/png', 0],
    ['image/png', 1.5],
    ['image/png', 10 * 1024 * 1024 + 1],
  ])('rejects an unsupported or invalid envelope (%s, %s)', async (contentType, size) => {
    const { useCase, portalRepo, uploadStore } = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await expect(
      useCase({ portalId: portal.id, contentType, fileSize: size }, ctx),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'upload_failed',
    )
    expect(uploadStore.all()).toEqual([])
  })

  it('rejects when portal not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext()

    await expect(
      useCase({ portalId: 'nonexistent', contentType: 'image/png', fileSize: 1024 }, ctx),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'portal_not_found',
    )
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const { useCase, portalRepo } = setup([])
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await expect(
      useCase({ portalId: portal.id, contentType: 'image/png', fileSize: 1024 }, ctx),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'forbidden',
    )
  })

  it('allows PropertyManager assigned to the property', async () => {
    const { useCase, portalRepo } = setup([
      propertyId('a0000000-0000-0000-0000-000000000001'),
    ])
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    const result = await useCase(
      { portalId: portal.id, contentType: 'image/png', fileSize: 1024 },
      ctx,
    )

    expect(result.uploadId).toBe(ISSUANCE_ID)
  })

  it('keeps the public failure stable when best-effort issuance rejection also fails', async () => {
    const { useCase, portalRepo, uploadStore, storage } = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    vi.spyOn(storage, 'createIssuedPortalUpload').mockRejectedValueOnce(
      new Error('signing failed'),
    )
    vi.spyOn(uploadStore, 'rejectIssued').mockRejectedValueOnce(
      new Error('cleanup failed'),
    )

    await expect(
      useCase({ portalId: portal.id, contentType: 'image/png', fileSize: 1024 }, ctx),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'upload_failed',
    )
  })

  it('does not reject an existing issuance when persistence fails before creation', async () => {
    const { useCase, portalRepo, uploadStore, storage } = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    vi.spyOn(uploadStore, 'create').mockRejectedValueOnce(new Error('duplicate id'))
    const rejectIssued = vi.spyOn(uploadStore, 'rejectIssued')
    const createStorageUpload = vi.spyOn(storage, 'createIssuedPortalUpload')

    await expect(
      useCase({ portalId: portal.id, contentType: 'image/png', fileSize: 1024 }, ctx),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'upload_failed',
    )
    expect(rejectIssued).not.toHaveBeenCalled()
    expect(createStorageUpload).not.toHaveBeenCalled()
  })
})
