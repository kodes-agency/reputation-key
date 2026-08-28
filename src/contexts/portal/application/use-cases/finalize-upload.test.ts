import { describe, expect, it, vi } from 'vitest'
import { finalizeUpload } from './finalize-upload'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalUploadIssuanceStore } from '#/shared/testing/in-memory-portal-upload-issuance-store'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { portalId, propertyId, type PropertyId } from '#/shared/domain/ids'
import type { IssuedPortalUploadStoragePort } from '../ports/storage.port'
import { createPortalHeroUploadIssuance } from '../../domain/upload-issuance'
import { portalHeroImageProcessingRequested } from '../../domain/events'

const ISSUANCE_ID = '70000000-0000-4000-8000-000000000001'
const SECOND_ISSUANCE_ID = '70000000-0000-4000-8000-000000000002'
const FIXED_TIME = new Date('2026-08-26T12:00:00.000Z')

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const setup = (input?: Readonly<{ accessible?: ReadonlyArray<PropertyId> | null }>) => {
  const portalRepo = createInMemoryPortalRepo()
  const uploadStore = createInMemoryPortalUploadIssuanceStore()
  const confirmIssuedPortalUpload = vi.fn<
    IssuedPortalUploadStoragePort['confirmIssuedPortalUpload']
  >(async () => ({
    contentType: 'image/png',
    sizeBytes: 1024,
    sourceETag: '"d41d8cd98f00b204e9800998ecf8427e"',
  }))
  const deleteIssuedPortalUpload = vi.fn<
    IssuedPortalUploadStoragePort['deleteIssuedPortalUpload']
  >(async () => {})
  const storage = {
    confirmIssuedPortalUpload,
    deleteIssuedPortalUpload,
  } satisfies Pick<
    IssuedPortalUploadStoragePort,
    'confirmIssuedPortalUpload' | 'deleteIssuedPortalUpload'
  >
  let currentTime = FIXED_TIME
  const buildUseCase = () =>
    finalizeUpload({
      portalRepo,
      uploadStore,
      storage,
      staffPublicApi: staffApiMock(input?.accessible ?? null),
      clock: () => currentTime,
    })
  return {
    portalRepo,
    uploadStore,
    storage,
    buildUseCase,
    confirmIssuedPortalUpload,
    deleteIssuedPortalUpload,
    setTime: (at: Date) => {
      currentTime = at
    },
  }
}

async function seedIssuedUpload(
  harness: ReturnType<typeof setup>,
  portal: ReturnType<typeof buildTestPortal>,
  id = ISSUANCE_ID,
) {
  const issuance = createPortalHeroUploadIssuance({
    id,
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    portalId: portal.id,
    contentType: 'image/png',
    declaredSizeBytes: 1024,
    now: FIXED_TIME,
  })
  if (!issuance) throw new Error('test issuance must be valid')
  await harness.uploadStore.create(issuance)
  return issuance
}

describe('finalizeUpload', () => {
  it('atomically records an ETag-bound processing fact without exposing an object key', async () => {
    const harness = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({ heroImageUrl: 'https://cdn.example.com/old.webp' })
    harness.portalRepo.seed([portal])
    await seedIssuedUpload(harness, portal)
    const useCase = harness.buildUseCase()

    const result = await useCase({ portalId: portal.id, uploadId: ISSUANCE_ID }, ctx)

    expect(result).toEqual({
      heroImageUrl: null,
      processing: true,
    })
    expect(harness.uploadStore.all()[0]).toEqual(
      expect.objectContaining({ state: 'consumed', consumedAt: FIXED_TIME }),
    )
    expect(harness.uploadStore.processingFacts()).toEqual([
      expect.objectContaining({
        _tag: 'portal.hero_image.processing_requested',
        uploadId: ISSUANCE_ID,
        sourceETag: '"d41d8cd98f00b204e9800998ecf8427e"',
      }),
    ])
    expect(harness.uploadStore.processingFacts()[0]).not.toHaveProperty('objectKey')
  })

  it('rejects replay before inspecting storage or enqueueing another job', async () => {
    const harness = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    harness.portalRepo.seed([portal])
    await seedIssuedUpload(harness, portal)
    const useCase = harness.buildUseCase()

    await useCase({ portalId: portal.id, uploadId: ISSUANCE_ID }, ctx)
    await expect(
      useCase({ portalId: portal.id, uploadId: ISSUANCE_ID }, ctx),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'upload_failed',
    )
    expect(harness.confirmIssuedPortalUpload).toHaveBeenCalledOnce()
  })

  it('never deletes a source that a concurrent finalizer has already consumed', async () => {
    const harness = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    harness.portalRepo.seed([portal])
    await seedIssuedUpload(harness, portal)
    harness.confirmIssuedPortalUpload.mockImplementationOnce(async () => {
      await harness.uploadStore.stage(
        {
          organizationId: portal.organizationId,
          propertyId: portal.propertyId,
          portalId: portal.id,
          issuanceId: ISSUANCE_ID,
        },
        {
          contentType: 'image/png',
          sizeBytes: 1024,
          sourceETag: '"concurrent-etag"',
        },
        portalHeroImageProcessingRequested({
          uploadId: ISSUANCE_ID,
          organizationId: portal.organizationId,
          propertyId: portal.propertyId,
          portalId: portal.id,
          sourceETag: '"concurrent-etag"',
          occurredAt: FIXED_TIME,
        }),
        FIXED_TIME,
      )
      throw new Error('verification transport failed in losing request')
    })

    await expect(
      harness.buildUseCase()({ portalId: portal.id, uploadId: ISSUANCE_ID }, ctx),
    ).rejects.toMatchObject({ code: 'upload_failed' })

    expect(harness.uploadStore.all()[0]?.state).toBe('consumed')
    expect(harness.deleteIssuedPortalUpload).not.toHaveBeenCalled()
  })

  it('rejects a cross-Portal issuance without inspecting its object', async () => {
    const harness = setup()
    const ctx = buildTestAuthContext()
    const ownedPortal = buildTestPortal({})
    const otherPortal = buildTestPortal({
      id: portalId('a0000000-0000-4000-8000-000000000099'),
      slug: 'other',
    })
    harness.portalRepo.seed([ownedPortal, otherPortal])
    await seedIssuedUpload(harness, ownedPortal)

    await expect(
      harness.buildUseCase()({ portalId: otherPortal.id, uploadId: ISSUANCE_ID }, ctx),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'upload_failed',
    )
    expect(harness.confirmIssuedPortalUpload).not.toHaveBeenCalled()
  })

  it('expires an old issuance without inspecting storage', async () => {
    const harness = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    harness.portalRepo.seed([portal])
    await seedIssuedUpload(harness, portal)
    harness.setTime(new Date('2026-08-26T12:15:00.000Z'))

    await expect(
      harness.buildUseCase()({ portalId: portal.id, uploadId: ISSUANCE_ID }, ctx),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'upload_failed',
    )
    expect(harness.confirmIssuedPortalUpload).not.toHaveBeenCalled()
    expect(harness.uploadStore.all()[0]).toEqual(
      expect.objectContaining({
        state: 'expired',
        expiredAt: new Date('2026-08-26T12:15:00.000Z'),
      }),
    )
  })

  it('fails closed when the issuance expires while storage metadata is being checked', async () => {
    const harness = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    harness.portalRepo.seed([portal])
    await seedIssuedUpload(harness, portal)
    harness.setTime(new Date('2026-08-26T12:14:59.000Z'))
    harness.confirmIssuedPortalUpload.mockImplementationOnce(async () => {
      harness.setTime(new Date('2026-08-26T12:15:00.000Z'))
      return {
        contentType: 'image/png',
        sizeBytes: 1024,
        sourceETag: '"d41d8cd98f00b204e9800998ecf8427e"',
      }
    })

    await expect(
      harness.buildUseCase()({ portalId: portal.id, uploadId: ISSUANCE_ID }, ctx),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'upload_failed',
    )
    expect(harness.uploadStore.all()[0]).toEqual(
      expect.objectContaining({
        state: 'expired',
        expiredAt: new Date('2026-08-26T12:15:00.000Z'),
      }),
    )
    expect(harness.deleteIssuedPortalUpload).toHaveBeenCalledOnce()
  })

  it.each([
    [
      {
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        sourceETag: '"d41d8cd98f00b204e9800998ecf8427e"',
      },
      'MIME',
    ],
    [
      {
        contentType: 'image/png',
        sizeBytes: 1025,
        sourceETag: '"d41d8cd98f00b204e9800998ecf8427e"',
      },
      'size',
    ],
    [
      {
        contentType: null,
        sizeBytes: 1024,
        sourceETag: '"d41d8cd98f00b204e9800998ecf8427e"',
      },
      'unknown MIME',
    ],
    [
      {
        contentType: 'image/png',
        sizeBytes: null,
        sourceETag: '"d41d8cd98f00b204e9800998ecf8427e"',
      },
      'unknown size',
    ],
    [{ contentType: 'image/png', sizeBytes: 1024, sourceETag: null }, 'missing ETag'],
  ])(
    'rejects and deletes an object with mismatched metadata (%s, %s)',
    async (observed, _label) => {
      const harness = setup()
      const ctx = buildTestAuthContext()
      const portal = buildTestPortal({})
      harness.portalRepo.seed([portal])
      await seedIssuedUpload(harness, portal)
      harness.confirmIssuedPortalUpload.mockResolvedValueOnce(observed)

      await expect(
        harness.buildUseCase()({ portalId: portal.id, uploadId: ISSUANCE_ID }, ctx),
      ).rejects.toSatisfy(
        (error: unknown) => isPortalError(error) && error.code === 'upload_failed',
      )
      expect(harness.deleteIssuedPortalUpload).toHaveBeenCalledOnce()
      expect(harness.uploadStore.all()[0]).toEqual(
        expect.objectContaining({ state: 'rejected', rejectedAt: FIXED_TIME }),
      )
    },
  )

  it('supersedes an older processing issuance when a newer upload is finalized', async () => {
    const harness = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    harness.portalRepo.seed([portal])
    await seedIssuedUpload(harness, portal)
    await seedIssuedUpload(harness, portal, SECOND_ISSUANCE_ID)
    const useCase = harness.buildUseCase()

    await useCase({ portalId: portal.id, uploadId: ISSUANCE_ID }, ctx)
    await useCase({ portalId: portal.id, uploadId: SECOND_ISSUANCE_ID }, ctx)

    expect(harness.uploadStore.all()).toEqual([
      expect.objectContaining({ state: 'superseded', supersededAt: FIXED_TIME }),
      expect.objectContaining({ state: 'consumed', consumedAt: FIXED_TIME }),
    ])
  })

  it('rejects when role lacks portal.update permission', async () => {
    const harness = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })
    const portal = buildTestPortal({})
    harness.portalRepo.seed([portal])
    await seedIssuedUpload(harness, portal)

    await expect(
      harness.buildUseCase()({ portalId: portal.id, uploadId: ISSUANCE_ID }, ctx),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'forbidden',
    )
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const harness = setup({ accessible: [] })
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    harness.portalRepo.seed([portal])
    await seedIssuedUpload(harness, portal)

    await expect(
      harness.buildUseCase()({ portalId: portal.id, uploadId: ISSUANCE_ID }, ctx),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'forbidden',
    )
  })

  it('allows PropertyManager assigned to the property', async () => {
    const harness = setup({
      accessible: [propertyId('a0000000-0000-0000-0000-000000000001')],
    })
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    harness.portalRepo.seed([portal])
    await seedIssuedUpload(harness, portal)

    await expect(
      harness.buildUseCase()({ portalId: portal.id, uploadId: ISSUANCE_ID }, ctx),
    ).resolves.toEqual({ heroImageUrl: null, processing: true })
  })
})
