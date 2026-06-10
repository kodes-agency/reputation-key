// Notification context — BullMQ worker job for insert-notification
// Consumes jobs from the queue and delegates to the use case.

import type { Job } from 'bullmq'
import type {
  InsertNotificationInput,
  InsertNotificationDeps,
} from '../../application/use-cases/insert-notification'
import { insertNotification } from '../../application/use-cases/insert-notification'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export const INSERT_NOTIFICATION_JOB_NAME = 'insert-notification'

export type InsertNotificationJobData = InsertNotificationInput

export function createInsertNotificationHandler(deps: InsertNotificationDeps) {
  const useCase = insertNotification(deps)

  return async (job: Job<InsertNotificationJobData>): Promise<void> => {
    return trace('job.insertNotification', async () => {
      const logger = getLogger().child({ jobId: job.id, type: job.data.type })

      logger.info('Processing insert-notification job')

      try {
        await useCase(job.data)
        logger.info('Notification inserted')
      } catch (err) {
        logger.error({ err }, 'insert-notification job failed')
        throw err // re-throw so BullMQ retries
      }
    })
  }
}
