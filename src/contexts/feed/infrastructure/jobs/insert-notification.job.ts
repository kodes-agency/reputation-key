// Feed notification surface — BullMQ worker job for insert-notification
// Consumes jobs from the queue and delegates to the use case.

import type { Job } from 'bullmq'
import type {
  InsertNotificationInput,
  InsertNotificationDeps,
} from '../../application/use-cases/insert-notification'
import { insertNotification } from '../../application/use-cases/insert-notification'
import { trace } from '#/shared/observability/trace'
import type {
  NotificationAudience,
  NotificationAudienceAuthorizer,
} from '../../application/notification-audience'
import { parseNotificationAudience } from '../../application/notification-audience'
import type { NotificationWorkState } from '../../application/notification-work-state'
import {
  parseOutboxNotificationDelivery,
  type OutboxNotificationDelivery,
} from '../outbox-notification-delivery'

export const INSERT_NOTIFICATION_JOB_NAME = 'insert-notification'

export type InsertNotificationJobData = InsertNotificationInput &
  Readonly<{
    audience: NotificationAudience
    /** Present only when a durable source fact owns this delivery. */
    delivery?: OutboxNotificationDelivery
  }>

export type NotificationDeliverySettlement = Readonly<{
  settleAuthorized: (
    input: InsertNotificationInput,
    delivery: OutboxNotificationDelivery,
    audience: NotificationAudience,
  ) => Promise<'applied' | 'duplicate'>
  settleObsolete: (
    source: Pick<InsertNotificationInput, 'organizationId'>,
    delivery: OutboxNotificationDelivery,
  ) => Promise<void>
}>

/** A grouped notice says how many of its items still stood when it was delivered. */
const withItemCount = (
  input: InsertNotificationInput,
  itemCount: number,
): InsertNotificationInput => ({
  ...input,
  payload: {
    ...(typeof input.payload === 'object' && input.payload !== null ? input.payload : {}),
    itemCount,
  },
})

type InsertNotificationJobDeps = InsertNotificationDeps &
  Readonly<{
    authorizeAudience: NotificationAudienceAuthorizer
    /** Whether the work the notice asks for is still waiting (ADR 0046). */
    workState: Pick<NotificationWorkState, 'isWaiting'>
    deliverySettlement?: NotificationDeliverySettlement
  }>

export const createInsertNotificationHandler = (deps: InsertNotificationJobDeps) => {
  const useCase = insertNotification(deps)

  return async (job: Job<InsertNotificationJobData>): Promise<void> => {
    return trace('job.insertNotification', async () => {
      const logger = deps.logger.child({ type: job.data.type })

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

        const rawDelivery = (
          job.data as InsertNotificationInput & Readonly<{ delivery?: unknown }>
        ).delivery
        const delivery = parseOutboxNotificationDelivery(job.data)
        if (rawDelivery !== undefined && !delivery) {
          throw new Error('invalid outbox delivery marker')
        }
        if (delivery && !deps.deliverySettlement) {
          throw new Error('outbox notification delivery settlement is unavailable')
        }

        const settleObsolete = async (): Promise<void> => {
          if (!delivery) return
          await deps.deliverySettlement!.settleObsolete(
            { organizationId: job.data.organizationId },
            delivery,
          )
        }

        const decision = await deps.authorizeAudience({
          userId: job.data.userId,
          organizationId: job.data.organizationId,
          propertyId: job.data.propertyId,
          audience,
        })
        if (decision === false) {
          await settleObsolete()
          logger.info(
            { audienceKind: audience.kind },
            'Notification suppressed: recipient is no longer eligible',
          )
          return
        }
        // The settling fact may already have been handled: it retires only
        // rows that exist, and this job runs on a slower queue. A notice for
        // finished work would stand unsettled forever and mail its request.
        const work = await deps.workState.isWaiting({
          organizationId: job.data.organizationId,
          type: job.data.type,
          resourceId: job.data.resourceId,
          audience,
        })
        if (work === false) {
          await settleObsolete()
          logger.info('Notification suppressed: its work is already done')
          return
        }

        const { audience: _audience, delivery: _delivery, ...queued } = job.data
        const input =
          decision === true ? queued : withItemCount(queued, decision.itemCount)
        if (delivery) {
          const outcome = await deps.deliverySettlement!.settleAuthorized(
            input,
            delivery,
            audience,
          )
          logger.info({ settlement: outcome }, 'Durable notification delivery settled')
        } else {
          await useCase(input, audience)
          logger.info('Notification inserted')
        }
      } catch (err) {
        logger.error({ err }, 'insert-notification job failed')
        throw err // re-throw so BullMQ retries
      }
    })
  }
}
