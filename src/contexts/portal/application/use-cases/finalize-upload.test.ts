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
import type { Queue } from '#/shared/jobs/queue'

const ISSUANCE_ID = '70000000-0000-4000-8000-000000000001'
const SECOND_ISSUANCE_ID = '70000000-0000-4000-8000-000000000002'
const FIXED_TIME = new Date('2026-08-26T12:00:00.000Z')

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const setup = (input?: Readonly<{ accessible?: ReadonlyArray<PropertyId> | null }>) => {
  const portalRepo = createInMemoryPortalRepo()
  const uploadStore = createInMemoryPortalUploadIssuanceStore()
  const confirmIssuedPortalUpload = vi.fn<
    IssuedPortalUploadStoragePort['confirmIssuedPortalUpload']
  >(async () => ({ contentType: 'image/png', sizeBytes: 1024 }))
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
  const buildUseCase = (queue: Queue | undefined = undefined) =>
    finalizeUpload({
      portalRepo,
      uploadStore,
      storage,
      staffPublicApi: staffApiMock(input?.accessible ?? null),
      clock: () => currentTime,
      queue,
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
  it('consumes the issued upload by opaque ID and never puts an object key in the job', async () => {
    const harness = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({ heroImageUrl: 'https://cdn.example.com/old.webp' })
    harness.portalRepo.seed([portal])
    await seedIssuedUpload(harness, portal)
    const add = vi.fn(
      async (_name: string, _data: unknown, _options: unknown) => undefined,
    )
    const useCase = harness.buildUseCase({ add } as unknown as Queue)

    const result = await useCase({ portalId: portal.id, uploadId: ISSUANCE_ID }, ctx)

    expect(result).toEqual({
      heroImageUrl: null,
      processing: true,
    })
    expect(harness.uploadStore.all()[0]).toEqual(
      expect.objectContaining({ state: 'consumed', consumedAt: FIXED_TIME }),
    )
    expect(add).toHaveBeenCalledOnce()
    const jobData = add.mock.calls[0]?.[1]
    expect(jobData).toEqual(expect.objectContaining({ uploadId: ISSUANCE_ID }))
    expect(jobData).not.toHaveProperty('key')
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
      return { contentType: 'image/png', sizeBytes: 1024 }
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
    [{ contentType: 'image/jpeg', sizeBytes: 1024 }, 'MIME'],
    [{ contentType: 'image/png', sizeBytes: 1025 }, 'size'],
    [{ contentType: null, sizeBytes: 1024 }, 'unknown MIME'],
    [{ contentType: 'image/png', sizeBytes: null }, 'unknown size'],
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
    ).resolves.toEqual({ heroImageUrl: null, processing: false })
  })
})
