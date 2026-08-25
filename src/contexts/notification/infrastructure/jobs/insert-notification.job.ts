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
import type {
  NotificationAudience,
  NotificationAudienceAuthorizer,
} from '../../application/notification-audience'
import { parseNotificationAudience } from '../../application/notification-audience'

export const INSERT_NOTIFICATION_JOB_NAME = 'insert-notification'

export type InsertNotificationJobData = InsertNotificationInput &
  Readonly<{ audience: NotificationAudience }>

type InsertNotificationJobDeps = InsertNotificationDeps &
  Readonly<{ authorizeAudience: NotificationAudienceAuthorizer }>

export const createInsertNotificationHandler = (deps: InsertNotificationJobDeps) => {
  const useCase = insertNotification(deps)

  return async (job: Job<InsertNotificationJobData>): Promise<void> => {
    return trace('job.insertNotification', async () => {
      const logger = getLogger().child({ type: job.data.type })

      logger.info('Processing insert-notification job')

      try {
        // Rolling deployments may leave pre-policy jobs in Redis. Without a
        // durable reason for delivery there is nothing safe to revalidate, so
        // consume those jobs without inserting a notification.
        const rawAudience = (
          job.data as InsertNotificationInput & Readonly<{ audience?: unknown }>
        ).audience
        const audience = parseNotificationAudience(rawAudience)
        if (!audience) {
          logger.warn(
            rawAudience === undefined
              ? 'Notification suppressed: missing audience descriptor'
              : 'Notification suppressed: invalid audience descriptor',
          )
          return
        }

        const authorized = await deps.authorizeAudience({
          userId: job.data.userId,
          organizationId: job.data.organizationId,
          propertyId: job.data.propertyId,
          audience,
        })
        if (!authorized) {
          logger.info(
            { audienceKind: audience.kind },
            'Notification suppressed: recipient is no longer eligible',
          )
          return
        }

        const { audience: _audience, ...input } = job.data
        await useCase(input)
        logger.info('Notification inserted')
      } catch (err) {
        logger.error({ err }, 'insert-notification job failed')
        throw err // re-throw so BullMQ retries
      }
    })
  }
}
