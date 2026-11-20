import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'

/** Queue name of the import item job before imports moved to one root per import. */
export const RETIRED_IMPORT_ITEM_JOB = 'import-gbp-property-item-v2' as const

/**
 * Completes a delivery that was queued under the retired name without acting on
 * it. Imports were drained before the move, so nothing legitimate can arrive;
 * an item that still needs work has no checkpoint here and is never started.
 */
export const createRetiredImportItemHandler =
  (logger: LoggerPort) =>
  async (job: Job): Promise<void> => {
    logger.warn(
      { job: RETIRED_IMPORT_ITEM_JOB, attemptsMade: job.attemptsMade },
      'discarded a Google import item job queued under the retired name',
    )
  }
