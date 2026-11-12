import type { Job } from 'bullmq'
import type { GoogleImportItemJobData } from '../../application/ports/gbp-queue.port'
import type { ProcessGoogleImportItem } from '../../application/google-import-processor'

type ImportItemDelivery = Omit<GoogleImportItemJobData, 'dispatchEpoch'> & {
  /** Absent only on queue entries accepted before generation fencing. */
  dispatchEpoch?: number
}

/**
 * BullMQ boundary for one import item. The deterministic job identity is
 * re-derived before handing current, content-free execution facts to the
 * fenced item processor.
 */
export const createGoogleImportItemJobHandler = (
  processItem: (input: ProcessGoogleImportItem) => Promise<void>,
) => {
  return async (job: Job<ImportItemDelivery>): Promise<void> => {
    const jobId = job.data.jobId
    const delivery = /-r([0-9]+)-d([0-9]+)-q[0-9a-f-]{36}$/i.exec(jobId)
    const generationMatches =
      job.data.dispatchEpoch === undefined
        ? jobId.endsWith(`-r${job.data.retryRevision}`)
        : delivery !== null &&
          delivery[1] === String(job.data.retryRevision) &&
          delivery[2] === String(job.data.dispatchEpoch)
    if (
      job.id !== jobId ||
      !jobId.startsWith(`import-item-${job.data.itemId}-l`) ||
      !generationMatches
    ) {
      throw new Error('google import item job identity mismatch')
    }
    await processItem({
      organizationId: job.data.organizationId,
      itemId: job.data.itemId,
      retryRevision: job.data.retryRevision,
      dispatchEpoch: job.data.dispatchEpoch ?? 0,
      attemptOrdinal: job.attemptsMade + 1,
    })
  }
}
