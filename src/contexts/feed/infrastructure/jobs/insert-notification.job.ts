// Feed notification surface — drains `insert-notification` jobs.
//
// Consumers write their notices in the transaction that claims their receipt,
// so nothing enqueues this job any more. A job an earlier release left in
// Redis is still written once, through the same writer, under the receipt name
// its enqueue recorded, so a delivery that already settled stays settled.

import { createHash } from 'node:crypto'
import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import { parseNotificationAudience } from '../../application/notification-audience'
import type { NotificationAudience } from '../../application/notification-audience'
import type { Notice, NoticeWriter } from '../../notify/consumers.server'
import { notificationDeliveryReceiptPrefixes } from '../notification-delivery-receipts'

export const INSERT_NOTIFICATION_JOB_NAME = 'insert-notification'

/** What a queued job carries: a notice, its source event and, once Redis accepted it, its delivery marker. */
export type InsertNotificationJobData = Omit<Notice, 'audience'> &
  Readonly<{
    eventId: string
    audience: NotificationAudience
    delivery?: Readonly<{ eventId: string; consumerName: string; receiptKey: string }>
  }>

const DRAINED_RECEIPT_PREFIX = 'notification.drained:'

type DrainJobDeps = Readonly<{
  noticeWriter: NoticeWriter
  logger: LoggerPort
}>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value !== ''

/** The receipt name the job's delivery claims, as its enqueue recorded it. */
function receiptNameFor(data: Readonly<Record<string, unknown>>): string {
  const delivery = data.delivery
  if (delivery === undefined) {
    const key = createHash('sha256')
      .update(JSON.stringify([data.type, data.userId, data.resourceId]))
      .digest('hex')
      .slice(0, 32)
    return `${DRAINED_RECEIPT_PREFIX}${key}`
  }
  if (
    !isRecord(delivery) ||
    delivery.eventId !== data.eventId ||
    !isNonEmptyString(delivery.consumerName) ||
    !isNonEmptyString(delivery.receiptKey)
  ) {
    throw new Error('invalid outbox delivery marker')
  }
  return `${notificationDeliveryReceiptPrefixes.materialized}${delivery.consumerName}:${delivery.receiptKey}`
}

export const createInsertNotificationDrainHandler = (deps: DrainJobDeps) => {
  return async (job: Job): Promise<void> => {
    return trace('job.insertNotification', async () => {
      const data: unknown = job.data
      if (
        !isRecord(data) ||
        ![
          'userId',
          'organizationId',
          'type',
          'resourceType',
          'resourceId',
          'eventId',
        ].every((key) => isNonEmptyString(data[key]))
      ) {
        throw new Error('invalid insert-notification job')
      }
      const logger = deps.logger.child({ type: data.type })
      logger.info('Draining insert-notification job')

      // A job queued before notices carried an audience has no durable reason
      // for delivery to revalidate; consume it without writing.
      const audience = parseNotificationAudience(data.audience)
      if (!audience) {
        logger.warn(
          data.audience === undefined
            ? 'Notification suppressed: missing audience descriptor'
            : 'Notification suppressed: invalid audience descriptor',
        )
        return
      }

      const { audience: _audience, delivery: _delivery, eventId, ...rest } = data
      const outcome = await deps.noticeWriter.write({
        eventId: eventId as string,
        consumerName: receiptNameFor(data),
        status: 'applied',
        notices: [{ ...(rest as Omit<Notice, 'audience'>), audience }],
      })
      logger.info({ settlement: outcome }, 'insert-notification job drained')
    })
  }
}
