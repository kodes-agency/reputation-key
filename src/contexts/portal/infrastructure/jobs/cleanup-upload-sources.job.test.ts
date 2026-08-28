import { describe, expect, it, vi } from 'vitest'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import {
  createCleanupPortalUploadSourcesHandler,
  PORTAL_UPLOAD_SOURCE_CLEANUP_LIMIT,
} from './cleanup-upload-sources.job'
import type { PortalUploadIssuance } from '../../domain/upload-issuance'

const AT = new Date('2026-08-27T12:00:00.000Z')
const logger = { info: vi.fn() }
const issuance = (id: string): PortalUploadIssuance => ({
  id,
  organizationId: organizationId('org-cleanup-0000-0000-0000-000000000001'),
  propertyId: propertyId('71000000-0000-4000-8000-000000000001'),
  portalId: portalId('72000000-0000-4000-8000-000000000001'),
  purpose: 'hero_image',
  objectKey: `private/portal-uploads/${id}/source.png`,
  contentType: 'image/png',
  declaredSizeBytes: 10,
  maxSizeBytes: 10 * 1024 * 1024,
  state: 'expired',
  issuedAt: new Date('2026-08-27T11:00:00.000Z'),
  expiresAt: new Date('2026-08-27T11:15:00.000Z'),
  consumedAt: null,
  finalizedAt: null,
  supersededAt: null,
  rejectedAt: null,
  expiredAt: new Date('2026-08-27T11:15:00.000Z'),
  heroDerivativeKey: null,
  thumbnailDerivativeKey: null,
  heroImageUrl: null,
  sourceDeletedAt: null,
  orphanDerivativesDeletedAt: null,
})

describe('Portal private upload source cleanup job', () => {
  it('deletes one bounded identifier-derived batch and marks exact states', async () => {
    const rows = [
      issuance('73000000-0000-4000-8000-000000000001'),
      issuance('73000000-0000-4000-8000-000000000002'),
    ]
    const listSourceCleanupCandidates = vi.fn(async () => rows)
    const deleteIssuedPortalUpload = vi.fn(async () => {})
    const deletePortalUploadDerivative = vi.fn(async () => {})
    const markSourceDeleted = vi.fn(async () => true)
    const markOrphanDerivativesDeleted = vi.fn(async () => true)

    await createCleanupPortalUploadSourcesHandler({
      uploadStore: {
        listSourceCleanupCandidates,
        markSourceDeleted,
        markOrphanDerivativesDeleted,
      },
      storage: { deleteIssuedPortalUpload, deletePortalUploadDerivative },
      clock: () => AT,
      logger,
    })({ data: { objectKey: 'caller-value-must-be-ignored' } } as never)

    expect(listSourceCleanupCandidates).toHaveBeenCalledWith(
      AT,
      PORTAL_UPLOAD_SOURCE_CLEANUP_LIMIT,
    )
    expect(deleteIssuedPortalUpload).toHaveBeenCalledTimes(2)
    expect(deletePortalUploadDerivative).toHaveBeenCalledTimes(4)
    expect(markSourceDeleted).toHaveBeenNthCalledWith(
      1,
      {
        organizationId: rows[0].organizationId,
        propertyId: rows[0].propertyId,
        portalId: rows[0].portalId,
        issuanceId: rows[0].id,
      },
      'expired',
      AT,
    )
  })

  it('continues the batch but requests a retry when any object delete fails', async () => {
    const rows = [
      issuance('73000000-0000-4000-8000-000000000003'),
      issuance('73000000-0000-4000-8000-000000000004'),
    ]
    const deleteIssuedPortalUpload = vi
      .fn()
      .mockRejectedValueOnce(new Error('private provider detail'))
      .mockResolvedValueOnce(undefined)
    const markSourceDeleted = vi.fn(async () => true)
    const markOrphanDerivativesDeleted = vi.fn(async () => true)
    const handler = createCleanupPortalUploadSourcesHandler({
      uploadStore: {
        listSourceCleanupCandidates: async () => rows,
        markSourceDeleted,
        markOrphanDerivativesDeleted,
      },
      storage: {
        deleteIssuedPortalUpload,
        deletePortalUploadDerivative: vi.fn(async () => {}),
      },
      clock: () => AT,
      logger,
    })

    await expect(handler({} as never)).rejects.toThrow(
      'Portal private upload source cleanup requires retry',
    )
    expect(deleteIssuedPortalUpload).toHaveBeenCalledTimes(2)
    expect(markSourceDeleted).toHaveBeenCalledTimes(1)
  })

  it('resumes orphan-derivative cleanup without repeating an already-recorded source delete', async () => {
    const row = {
      ...issuance('73000000-0000-4000-8000-000000000005'),
      sourceDeletedAt: new Date('2026-08-27T11:30:00.000Z'),
    }
    const deleteIssuedPortalUpload = vi.fn(async () => {})
    const deletePortalUploadDerivative = vi.fn(async () => {})
    const markSourceDeleted = vi.fn(async () => true)
    const markOrphanDerivativesDeleted = vi.fn(async () => true)

    await createCleanupPortalUploadSourcesHandler({
      uploadStore: {
        listSourceCleanupCandidates: async () => [row],
        markSourceDeleted,
        markOrphanDerivativesDeleted,
      },
      storage: { deleteIssuedPortalUpload, deletePortalUploadDerivative },
      clock: () => AT,
      logger,
    })({} as never)

    expect(deleteIssuedPortalUpload).not.toHaveBeenCalled()
    expect(markSourceDeleted).not.toHaveBeenCalled()
    expect(deletePortalUploadDerivative).toHaveBeenCalledTimes(2)
    expect(markOrphanDerivativesDeleted).toHaveBeenCalledOnce()
  })
})
