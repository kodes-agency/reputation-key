import type { ContactRequestRepository } from '../ports/contact-request.repository'

export const DEFAULT_CONTACT_REQUEST_RETENTION_MAX_BATCHES = 100

export type ContactRequestRetentionSweepResult = Readonly<{
  batches: number
  processed: number
  capped: boolean
  completedThrough: Date | null
}>

export const contactRequestRetentionSweep = (
  deps: Readonly<{
    repo: Pick<ContactRequestRepository, 'purgeExpired'>
    clock: () => Date
    maxBatches?: number
  }>,
) => {
  const maxBatches = deps.maxBatches ?? DEFAULT_CONTACT_REQUEST_RETENTION_MAX_BATCHES
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 100) {
    throw new Error('Contact Request retention bounds are invalid')
  }

  return async (input: Readonly<{ batchSize: number }>) => {
    if (
      !Number.isSafeInteger(input.batchSize) ||
      input.batchSize < 1 ||
      input.batchSize > 1_000
    ) {
      throw new Error('Contact Request retention bounds are invalid')
    }

    const through = deps.clock()
    let batches = 0
    let processed = 0
    let completedThrough: Date | null = null

    while (batches < maxBatches) {
      const result = await deps.repo.purgeExpired({
        through,
        batchSize: input.batchSize,
      })
      completedThrough = result.completedThrough
      if (result.processed === 0) {
        return { batches, processed, capped: false, completedThrough }
      }
      batches += 1
      processed += result.processed
    }

    return { batches, processed, capped: true, completedThrough }
  }
}
