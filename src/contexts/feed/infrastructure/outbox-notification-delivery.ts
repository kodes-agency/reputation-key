import { createHash } from 'node:crypto'
import type { JobsOptions } from 'bullmq'
import type { OutboxRepository } from '#/shared/outbox'
import { BETA_NOTIFICATION_TRIGGER_MATRIX } from '../application/beta-notification-trigger-matrix'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'

const INSERT_NOTIFICATION_JOB = 'insert-notification'
const ENQUEUE_RECEIPT_PREFIX = 'notification.enqueue:'
const MATERIALIZED_RECEIPT_PREFIX = 'notification.materialized:'

type DeliveryRoute = Readonly<{
  eventType: string
  consumerName: string
}>

export type OutboxNotificationDelivery = DeliveryRoute &
  Readonly<{
    eventId: string
    receiptKey: string
    enqueueReceiptName: string
    materializedReceiptName: string
  }>

type NotificationJobIdentity = Readonly<{
  userId: string
  organizationId: string
  propertyId: string | null
  type: string
  resourceType: string
  resourceId: string
  eventId: string
}>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseJobIdentity(value: unknown): NotificationJobIdentity | null {
  if (!isRecord(value)) return null
  const keys = [
    'userId',
    'organizationId',
    'type',
    'resourceType',
    'resourceId',
    'eventId',
  ] as const
  if (keys.some((key) => typeof value[key] !== 'string' || value[key] === '')) {
    return null
  }
  if (
    value.propertyId !== null &&
    (typeof value.propertyId !== 'string' || value.propertyId === '')
  ) {
    return null
  }
  return {
    ...(Object.fromEntries(keys.map((key) => [key, value[key]])) as Omit<
      NotificationJobIdentity,
      'propertyId'
    >),
    propertyId: value.propertyId,
  }
}

function receiptKey(route: DeliveryRoute, job: NotificationJobIdentity): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        route.eventType,
        route.consumerName,
        job.eventId,
        job.organizationId,
        job.propertyId,
        job.userId,
        job.type,
        job.resourceType,
        job.resourceId,
      ]),
    )
    .digest('hex')
    .slice(0, 32)
}

function receiptNames(route: DeliveryRoute, key: string) {
  return {
    enqueueReceiptName: `${ENQUEUE_RECEIPT_PREFIX}${route.consumerName}:${key}`,
    materializedReceiptName: `${MATERIALIZED_RECEIPT_PREFIX}${route.consumerName}:${key}`,
  } as const
}

function routeAcceptsType(route: DeliveryRoute, type: string): boolean {
  const row = BETA_NOTIFICATION_TRIGGER_MATRIX.find(
    (candidate) =>
      candidate.eventType === route.eventType &&
      candidate.consumerName === route.consumerName,
  )
  return row?.notifications.some((notification) => notification.type === type) === true
}

function createDelivery(
  route: DeliveryRoute,
  job: NotificationJobIdentity,
): OutboxNotificationDelivery {
  const key = receiptKey(route, job)
  return {
    ...route,
    eventId: job.eventId,
    receiptKey: key,
    ...receiptNames(route, key),
  }
}

/**
 * Parse and validate the content-free delivery marker carried by a queued
 * notification. The receipt key is recomputed from the job identity so an
 * accidental or partial mutation cannot redirect settlement to another event,
 * recipient, resource, or route. PostgreSQL separately verifies the source
 * event's route and tenant before it accepts the materialization claim.
 */
export function parseOutboxNotificationDelivery(
  value: unknown,
): OutboxNotificationDelivery | null {
  const job = parseJobIdentity(value)
  if (!job || !isRecord(value)) return null
  const raw = value.delivery
  if (
    !isRecord(raw) ||
    typeof raw.eventId !== 'string' ||
    typeof raw.eventType !== 'string' ||
    typeof raw.consumerName !== 'string' ||
    typeof raw.receiptKey !== 'string'
  ) {
    return null
  }
  const route = { eventType: raw.eventType, consumerName: raw.consumerName }
  if (
    raw.eventId !== job.eventId ||
    !routeAcceptsType(route, job.type) ||
    raw.receiptKey !== receiptKey(route, job)
  ) {
    return null
  }
  return createDelivery(route, job)
}

type QueuePort = Readonly<{
  add(name: string, data: unknown, opts?: JobsOptions): Promise<unknown>
}>

/**
 * Decorate an outbox-backed enqueue with its materialization identity. Redis
 * acceptance happens first; only then is the per-delivery enqueue receipt
 * written. A failure on either side leaves the base consumer unacknowledged,
 * so normal outbox replay remains the repair authority.
 */
export function withOutboxNotificationDelivery(
  queue: QueuePort,
  receipts: Pick<OutboxRepository, 'insertReceipt'>,
  route: DeliveryRoute,
): NotificationJobEnqueuePort {
  return {
    add: async (name, data, opts) => {
      if (name !== INSERT_NOTIFICATION_JOB) {
        throw new Error(`notification delivery bridge cannot enqueue ${name}`)
      }
      const job = parseJobIdentity(data)
      if (!job || !routeAcceptsType(route, job.type)) {
        throw new Error('notification delivery bridge received an invalid job identity')
      }
      const delivery = createDelivery(route, job)
      const queued = await queue.add(
        name,
        { ...(data as Readonly<Record<string, unknown>>), delivery },
        opts,
      )
      await receipts.insertReceipt(job.eventId, delivery.enqueueReceiptName, 'applied')
      return queued
    },
  }
}

/**
 * Queue used by every durable consumer. The executable beta matrix guarantees
 * one route per active type, and deterministic job ids make redelivery carry
 * the same settlement marker. Retained beta-dark types pass through without
 * claiming durability.
 */
export function withBetaOutboxNotificationDelivery(
  queue: QueuePort,
  receipts: Pick<OutboxRepository, 'insertReceipt'>,
): NotificationJobEnqueuePort {
  return {
    add: async (name, data, opts) => {
      if (name !== INSERT_NOTIFICATION_JOB) return queue.add(name, data, opts)
      const job = parseJobIdentity(data)
      if (!job) {
        throw new Error('notification delivery bridge received an invalid job identity')
      }
      const routes = BETA_NOTIFICATION_TRIGGER_MATRIX.filter((row) =>
        row.notifications.some((notification) => notification.type === job.type),
      )
      if (routes.length === 0) return queue.add(name, data, opts)
      if (routes.length !== 1) {
        throw new Error(`notification type ${job.type} has ambiguous durable routes`)
      }
      const route = routes[0]!
      return withOutboxNotificationDelivery(queue, receipts, {
        eventType: route.eventType,
        consumerName: route.consumerName,
      }).add(name, data, opts)
    },
  }
}

const REPAIR_JOB_ID_PREFIX = 'notification-repair-'

type HeldJobPort = Readonly<{
  getState(): Promise<string>
  remove(): Promise<void>
}>

type RepairQueuePort = QueuePort &
  Readonly<{
    getJob(id: string): Promise<HeldJobPort | undefined>
  }>

/**
 * BullMQ keeps a job that spent its attempts in its failed set, and an add
 * under an id it still holds is a no-op. A repair job that dead-lettered is
 * released, so this firing queues it again with a fresh attempt budget; its
 * quarantine copy stays for the operator. A waiting, delayed or active repair
 * job is left alone — the add converges on it.
 */
async function releaseDeadLetteredRepair(queue: RepairQueuePort, jobId: string) {
  const held = await queue.getJob(jobId)
  if (held && (await held.getState()) === 'failed') await held.remove()
}

/**
 * The queue a delivery repair enqueues through, beneath the durable bridge.
 * Replaying a source fact re-derives every recipient; a delivery that already
 * settled is left alone, since its job could only settle as a duplicate. Any
 * other delivery is queued under an id of its own, derived from the delivery:
 * a retained original job (failed, quarantined) cannot swallow the repair, and
 * a later sweep converges on the same repair job instead of queueing another,
 * unless that repair job itself dead-lettered.
 */
export function withDeliveryRepairJobs(
  queue: RepairQueuePort,
  receipts: Pick<OutboxRepository, 'hasReceipt'>,
): QueuePort {
  return {
    add: async (name, data, opts) => {
      const delivery = parseOutboxNotificationDelivery(data)
      if (!delivery) {
        throw new Error('notification delivery repair requires a durable delivery marker')
      }
      if (await receipts.hasReceipt(delivery.eventId, delivery.materializedReceiptName)) {
        return undefined
      }
      const jobId = `${REPAIR_JOB_ID_PREFIX}${delivery.receiptKey}`
      await releaseDeadLetteredRepair(queue, jobId)
      return queue.add(name, data, { ...opts, jobId })
    },
  }
}

export const notificationDeliveryReceiptPrefixes = {
  enqueue: ENQUEUE_RECEIPT_PREFIX,
  materialized: MATERIALIZED_RECEIPT_PREFIX,
} as const
