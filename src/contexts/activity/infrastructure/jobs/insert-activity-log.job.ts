// Activity context — BullMQ worker job handler
// Consumes jobs from the 'default' queue with name 'insert-activity-log'.
// Per architecture (ADR 0010): "Worker consumes jobs, calls insertActivityLog use case."

import type {
  InsertActivityLogDeps,
  InsertActivityLogInput,
} from '../../application/use-cases/insert-activity-log'
import { insertActivityLog } from '../../application/use-cases/insert-activity-log'
import type { Job } from 'bullmq'
import { getLogger } from '#/shared/observability/logger'

export const INSERT_ACTIVITY_LOG_JOB_NAME = 'insert-activity-log'

export type InsertActivityLogJobData = InsertActivityLogInput

export function createInsertActivityLogHandler(deps: InsertActivityLogDeps) {
  const useCase = insertActivityLog(deps)
  return async (job: Job<InsertActivityLogJobData>): Promise<void> => {
    const log = getLogger().child({ jobId: job.id, resourceId: job.data.resourceId })
    log.info('Processing insert-activity-log job')
    await useCase(job.data)
    log.info('Inserted activity log')
  }
}
