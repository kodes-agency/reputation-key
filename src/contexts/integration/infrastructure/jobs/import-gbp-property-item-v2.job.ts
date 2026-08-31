import type { Job } from 'bullmq'
import type { GoogleImportV2ItemJobData } from '../../application/ports/gbp-queue.port'
import type { ProcessGoogleImportV2Item } from '../../application/google-import-v2-processor'

/**
 * BullMQ boundary for one import item. The deterministic job identity is
 * re-derived before handing current, content-free execution facts to the
 * fenced item processor.
 */
export const createGoogleImportV2ItemJobHandler = (
  processItem: (input: ProcessGoogleImportV2Item) => Promise<void>,
) => {
  return async (job: Job<GoogleImportV2ItemJobData>): Promise<void> => {
    const jobId = job.data.jobId
    if (
      job.id !== jobId ||
      !jobId.startsWith(`import-item-${job.data.itemId}-l`) ||
      !jobId.endsWith(`-r${job.data.retryRevision}`)
    ) {
      throw new Error('google import item job identity mismatch')
    }
    await processItem({
      organizationId: job.data.organizationId,
      itemId: job.data.itemId,
      retryRevision: job.data.retryRevision,
      attemptOrdinal: job.attemptsMade + 1,
    })
  }
}
