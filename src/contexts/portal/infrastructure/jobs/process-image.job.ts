import type { Job } from 'bullmq'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import type { IssuedPortalUploadStoragePort } from '../../application/ports/storage.port'
import type { PortalUploadIssuanceStore } from '../../application/ports/portal-upload-issuance-store.port'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { JobExecutionEnvelope } from '#/shared/jobs/delayed-execution-gate'
import { portalError } from '../../domain/errors'

export const JOB_NAME = 'process-image' as const

export type ProcessImageJobData = JobExecutionEnvelope &
  Readonly<{
    uploadId: string
    portalId: string
    sourceETag: string
  }>

export type ProcessIssuedPortalImageInput = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  uploadId: string
  sourceETag: string
}>

export type ProcessImageJobDeps = Readonly<{
  storage: Pick<
    IssuedPortalUploadStoragePort,
    'readIssuedPortalUpload' | 'writePortalUploadDerivative' | 'deleteIssuedPortalUpload'
  >
  uploadStore: PortalUploadIssuanceStore
  clock: () => Date
}>

export const createProcessIssuedPortalImage = (deps: ProcessImageJobDeps) => {
  return async function processIssuedPortalImage(
    data: ProcessIssuedPortalImageInput,
  ): Promise<'processed' | 'stale'> {
    return trace('job.processImage', async () => {
      const logger = getLogger()
      if (!data.propertyId) {
        throw portalError('upload_failed', 'Image job is missing Property scope')
      }
      const scope = {
        organizationId: organizationId(data.organizationId),
        propertyId: propertyId(data.propertyId),
        portalId: portalId(data.portalId),
        issuanceId: data.uploadId,
      }
      const issuance = await deps.uploadStore.findProcessable(scope)
      if (!issuance) {
        // A retry after publication, or a worker for an upload superseded by a
        // newer finalization, is a safe no-op. It can never name another key.
        logger.info('Skipped stale or already processed portal image job')
        return 'stale'
      }

      logger.info('Processing issued portal hero image')
      try {
        const sharp = (await import('sharp')).default
        const originalBuffer = await deps.storage.readIssuedPortalUpload(
          issuance,
          data.sourceETag,
        )

        const heroBuffer = await sharp(originalBuffer, {
          failOn: 'warning',
          limitInputPixels: 40_000_000,
        })
          .rotate()
          .resize(1200, 630, { fit: 'cover', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer()

        const thumbnailBuffer = await sharp(originalBuffer, {
          failOn: 'warning',
          limitInputPixels: 40_000_000,
        })
          .rotate()
          .resize(400, 210, { fit: 'cover', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer()

        const hero = await deps.storage.writePortalUploadDerivative(
          issuance,
          'hero',
          heroBuffer,
          'image/webp',
        )
        const thumbnail = await deps.storage.writePortalUploadDerivative(
          issuance,
          'thumbnail',
          thumbnailBuffer,
          'image/webp',
        )
        const published = await deps.uploadStore.publishDerivative(
          scope,
          {
            heroKey: hero.objectKey,
            thumbnailKey: thumbnail.objectKey,
            heroImageUrl: hero.publicUrl,
          },
          deps.clock(),
        )
        if (published.outcome !== 'published') {
          logger.info('Discarded derivatives from a stale portal image job')
          return 'stale'
        }

        try {
          await deps.storage.deleteIssuedPortalUpload(issuance)
        } catch {
          logger.warn('Portal image published; private source cleanup is pending')
        }
        logger.info('Issued portal hero image processing completed')
        return 'processed'
      } catch (err) {
        logger.error({ err }, 'Issued portal image processing failed')
        throw err
      }
    })
  }
}

export const createProcessImageJob = (deps: ProcessImageJobDeps) => {
  const processIssuedPortalImage = createProcessIssuedPortalImage(deps)
  return async function processImageJob(job: Job<ProcessImageJobData>): Promise<void> {
    if (!job.data.propertyId) {
      throw portalError('upload_failed', 'Image job is missing Property scope')
    }
    await processIssuedPortalImage({
      organizationId: job.data.organizationId,
      propertyId: job.data.propertyId,
      portalId: job.data.portalId,
      uploadId: job.data.uploadId,
      sourceETag: job.data.sourceETag,
    })
  }
}
