import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { createProcessImageJob, type ProcessImageJobData } from './process-image.job'
import { createInMemoryPortalUploadIssuanceStore } from '#/shared/testing/in-memory-portal-upload-issuance-store'
import { createPortalHeroUploadIssuance } from '../../domain/upload-issuance'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { createJobExecutionEnvelope } from '#/shared/jobs/delayed-execution-gate'
import type { IssuedPortalUploadStoragePort } from '../../application/ports/storage.port'
import { portalHeroImageProcessingRequested } from '../../domain/events'

const NOW = new Date('2026-08-26T12:00:00.000Z')
const ORG_ID = organizationId('org-1')
const PROPERTY_ID = propertyId('a0000000-0000-4000-8000-000000000001')
const PORTAL_ID = portalId('a0000000-0000-4000-8000-000000000002')
const UPLOAD_ID = '70000000-0000-4000-8000-000000000001'
const SOURCE_ETAG = '"d41d8cd98f00b204e9800998ecf8427e"'

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

function issued(id = UPLOAD_ID) {
  const issuance = createPortalHeroUploadIssuance({
    id,
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    portalId: PORTAL_ID,
    contentType: 'image/png',
    declaredSizeBytes: PNG_1PX.byteLength,
    now: NOW,
  })
  if (!issuance) throw new Error('test issuance must be valid')
  return issuance
}

function jobData(uploadId = UPLOAD_ID): Job<ProcessImageJobData> {
  return {
    data: {
      uploadId,
      portalId: PORTAL_ID,
      sourceETag: SOURCE_ETAG,
      ...createJobExecutionEnvelope({
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        capability: 'portal.upload',
        initiator: { kind: 'user', id: 'user-1' },
      }),
    },
  } as unknown as Job<ProcessImageJobData>
}

const observed = {
  contentType: 'image/png',
  sizeBytes: PNG_1PX.byteLength,
  sourceETag: SOURCE_ETAG,
} as const

const processingEvent = (uploadId: string) =>
  portalHeroImageProcessingRequested({
    uploadId,
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    portalId: PORTAL_ID,
    sourceETag: SOURCE_ETAG,
    occurredAt: NOW,
  })

describe('process-image job', () => {
  it('publishes newly derived variants once and ignores an already-derived retry', async () => {
    const uploadStore = createInMemoryPortalUploadIssuanceStore()
    const issuance = issued()
    await uploadStore.create(issuance)
    await uploadStore.stage(
      {
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        portalId: PORTAL_ID,
        issuanceId: UPLOAD_ID,
      },
      observed,
      processingEvent(UPLOAD_ID),
      NOW,
    )
    const writePortalUploadDerivative = vi.fn(
      async (_issuance: typeof issuance, derivative: 'hero' | 'thumbnail') => ({
        objectKey: `public/portal-heroes/${UPLOAD_ID}/${derivative}.webp`,
        publicUrl: `https://cdn.example.com/${UPLOAD_ID}/${derivative}.webp`,
      }),
    )
    const deleteIssuedPortalUpload = vi.fn(async () => {})
    const readIssuedPortalUpload = vi.fn(async () => PNG_1PX)
    const storage = {
      readIssuedPortalUpload,
      writePortalUploadDerivative,
      deleteIssuedPortalUpload,
    } as unknown as IssuedPortalUploadStoragePort

    await createProcessImageJob({ storage, uploadStore, clock: () => NOW })(jobData())

    expect(readIssuedPortalUpload).toHaveBeenCalledWith(
      expect.objectContaining({ id: UPLOAD_ID }),
      SOURCE_ETAG,
    )
    expect(writePortalUploadDerivative).toHaveBeenCalledTimes(2)
    expect(writePortalUploadDerivative.mock.calls.map((call) => call[1])).toEqual([
      'hero',
      'thumbnail',
    ])
    expect(deleteIssuedPortalUpload).toHaveBeenCalledOnce()
    expect(uploadStore.all()[0]).toEqual(
      expect.objectContaining({
        state: 'finalized',
        heroDerivativeKey: `public/portal-heroes/${UPLOAD_ID}/hero.webp`,
        thumbnailDerivativeKey: `public/portal-heroes/${UPLOAD_ID}/thumbnail.webp`,
      }),
    )

    readIssuedPortalUpload.mockClear()
    writePortalUploadDerivative.mockClear()
    deleteIssuedPortalUpload.mockClear()
    await createProcessImageJob({ storage, uploadStore, clock: () => NOW })(jobData())
    expect(readIssuedPortalUpload).not.toHaveBeenCalled()
    expect(writePortalUploadDerivative).not.toHaveBeenCalled()
    expect(deleteIssuedPortalUpload).not.toHaveBeenCalled()
  })

  it('does not read or write storage for a superseded worker', async () => {
    const uploadStore = createInMemoryPortalUploadIssuanceStore()
    const old = issued()
    const next = issued('70000000-0000-4000-8000-000000000002')
    await uploadStore.create(old)
    await uploadStore.create(next)
    const scope = {
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      portalId: PORTAL_ID,
    }
    await uploadStore.stage(
      { ...scope, issuanceId: old.id },
      observed,
      processingEvent(old.id),
      NOW,
    )
    await uploadStore.stage(
      { ...scope, issuanceId: next.id },
      observed,
      processingEvent(next.id),
      NOW,
    )
    const readIssuedPortalUpload = vi.fn(async () => PNG_1PX)
    const writePortalUploadDerivative = vi.fn()
    const storage = {
      readIssuedPortalUpload,
      writePortalUploadDerivative,
    } as unknown as IssuedPortalUploadStoragePort

    await createProcessImageJob({ storage, uploadStore, clock: () => NOW })(
      jobData(old.id),
    )

    expect(readIssuedPortalUpload).not.toHaveBeenCalled()
    expect(writePortalUploadDerivative).not.toHaveBeenCalled()
    expect(uploadStore.all()[0]?.state).toBe('superseded')
  })

  it('fails closed when the source is not a decodable image', async () => {
    const uploadStore = createInMemoryPortalUploadIssuanceStore()
    const issuance = issued()
    await uploadStore.create(issuance)
    await uploadStore.stage(
      {
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        portalId: PORTAL_ID,
        issuanceId: UPLOAD_ID,
      },
      observed,
      processingEvent(UPLOAD_ID),
      NOW,
    )
    const writePortalUploadDerivative = vi.fn()
    const storage = {
      readIssuedPortalUpload: async () => Buffer.from('not an image'),
      writePortalUploadDerivative,
    } as unknown as IssuedPortalUploadStoragePort

    await expect(
      createProcessImageJob({ storage, uploadStore, clock: () => NOW })(jobData()),
    ).rejects.toBeDefined()
    expect(writePortalUploadDerivative).not.toHaveBeenCalled()
    expect(uploadStore.all()[0]?.state).toBe('consumed')
  })
})
