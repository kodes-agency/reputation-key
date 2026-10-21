import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import type {
  ReleaseDueResponseTargetReminders,
  ReminderReleaseCounts,
} from '../../application/use-cases/release-response-target-reminders'

export const JOB_NAME = 'release-response-target-reminders' as const

type ReleaseResponseTargetRemindersHandlerDeps = Readonly<{
  release: ReleaseDueResponseTargetReminders
  logger: Pick<LoggerPort, 'info'>
}>

/**
 * One content-free, bounded release pass per five-minute scheduler tick. The
 * pass reads Google for the Google-review reminders (at most 20 reads), so it
 * logs counts only: no review text, no provider id.
 */
export const createReleaseResponseTargetRemindersHandler = (
  deps: ReleaseResponseTargetRemindersHandlerDeps,
) => {
  return async (_job: Job): Promise<ReminderReleaseCounts> =>
    trace(`job.${JOB_NAME}`, async () => {
      const result = await deps.release()
      deps.logger.info(
        { job: JOB_NAME, ...result },
        'Response Target reminder release completed',
      )
      return result
    })
}
