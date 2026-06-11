// Portal context — image processing job
// BullMQ job handler for resizing and converting portal hero images.
// Downloads from R2, resizes via sharp, uploads variants back.

import type { Job } from 'bullmq'

export const JOB_NAME = 'process-image' as const
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import type { StoragePort } from '../../application/ports/storage.port'
import type { PortalRepository } from '../../application/ports/portal.repository'
import { portalError } from '../../domain/errors'
import { organizationId, portalId } from '#/shared/domain/ids'

export type ProcessImageJobData = Readonly<{
  key: string
  portalId: string
  organizationId: string
}>

export type ProcessImageJobDeps = Readonly<{
  storage: StoragePort
  portalRepo: PortalRepository
  clock: () => Date
}>

export function createProcessImageJob(deps: ProcessImageJobDeps) {
  return async function processImageJob(job: Job<ProcessImageJobData>): Promise<void> {
    return trace('job.processImage', async () => {
      const logger = getLogger()
      const { key, portalId: pid, organizationId: orgId } = job.data

      logger.info(
        { key, portalId: pid, organizationId: orgId, jobId: job.id },
        'Processing portal hero image',
      )

      try {
        // Dynamically import sharp to avoid loading it in the web bundle
        const sharp = (await import('sharp')).default

        // 1. Download original from R2
        const publicUrl = deps.storage.getPublicUrl(key)
        const response = await fetch(publicUrl)
        if (!response.ok) {
          throw portalError(
            'upload_failed',
            `Failed to download image: ${response.status} ${response.statusText}`,
          )
        }
        const originalBuffer = Buffer.from(await response.arrayBuffer())

        // 2. Resize and convert to WebP variants
        const heroBuffer = await sharp(originalBuffer)
          .resize(1200, 630, { fit: 'cover', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer()

        const thumbBuffer = await sharp(originalBuffer)
          .resize(400, 210, { fit: 'cover', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer()

        // 3. Upload variants back to R2
        const heroKey = key.replace(/\/hero\/([^/]+)$/, '/hero/webp/$1.webp')
        const thumbKey = key.replace(/\/hero\/([^/]+)$/, '/hero/thumb/$1.webp')

        await deps.storage.putObject(heroKey, heroBuffer, 'image/webp')
        await deps.storage.putObject(thumbKey, thumbBuffer, 'image/webp')

        // 4. Update portal.heroImageUrl with the hero variant URL
        const heroImageUrl = deps.storage.getPublicUrl(heroKey)
        await deps.portalRepo.update(organizationId(orgId), portalId(pid), {
          heroImageUrl,
          updatedAt: deps.clock(),
        })

        logger.info(
          { key, heroKey, thumbKey, portalId: pid },
          'Image processing completed',
        )
      } catch (err) {
        logger.error({ err, key, portalId: pid }, 'Image processing failed')
        throw err
      }
    })
  }
}
