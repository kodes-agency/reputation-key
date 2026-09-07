import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { notificationEmailQueue, notifications } from '#/shared/db/schema'
import { eventConsumerReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import type {
  NotificationDeliveryLagReport,
  NotificationDeliveryLagRepository,
} from '../../application/ports/notification-delivery-lag.repository'
import { MAX_NOTIFICATION_DELIVERY_LAG_SCAN_LIMIT } from '../../application/ports/notification-delivery-lag.repository'
import { BETA_NOTIFICATION_TRIGGER_MATRIX } from '../../application/beta-notification-trigger-matrix'
import { notificationDeliveryReceiptPrefixes } from '../outbox-notification-delivery'

type PendingRow = Readonly<{
  pending: number
  oldest: Date | string | null
}>

type MaterializationPendingRow = Readonly<{
  pending: number
  oldestSource: Date | string | null
  oldestEnqueued: Date | string | null
}>

type ImmediateEmailAcceptanceRow = Readonly<{
  status: string
  lastErrorClass: string | null
  retryCount: number
  attemptedAt: Date | string | null
  acceptedAt: Date | string | null
  sourceRecordedAt: Date | string | null
}>

const asDate = (value: Date | string | null | undefined): Date | null =>
  value === null || value === undefined
    ? null
    : value instanceof Date
      ? value
      : new Date(value)

const routeValues = sql.join(
  BETA_NOTIFICATION_TRIGGER_MATRIX.map(
    (row) => sql`(${row.eventType}::text, ${row.consumerName}::text)`,
  ),
  sql`, `,
)

const activeNotificationTypeValues = sql.join(
  [
    ...new Set(
      BETA_NOTIFICATION_TRIGGER_MATRIX.flatMap((row) =>
        row.notifications.map((notification) => notification.type),
      ),
    ),
  ].map((type) => sql`(${type}::text)`),
  sql`, `,
)

const isAwaitingProviderAcceptance = (row: ImmediateEmailAcceptanceRow): boolean =>
  row.acceptedAt === null &&
  (row.status === 'pending' ||
    row.status === 'delayed' ||
    (row.status === 'failed' && row.lastErrorClass === 'transient' && row.retryCount < 5))

const nearestRankP99 = (values: ReadonlyArray<number>): number | null => {
  if (values.length === 0) return null
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.ceil(ordered.length * 0.99) - 1] ?? null
}

/**
 * Reads only identifiers, receipt names, and timestamps. Event payload is
 * intentionally absent from both SELECT lists, so content cannot leak into a
 * health response or log through this repository.
 */
export const createNotificationDeliveryLagRepository = (
  db: Database,
): NotificationDeliveryLagRepository => {
  return {
    read: async (window): Promise<NotificationDeliveryLagReport> => {
      if (!Number.isSafeInteger(window.scanLimit) || window.scanLimit < 1) {
        throw new Error('notification delivery lag scanLimit must be a positive integer')
      }
      if (window.scanLimit > MAX_NOTIFICATION_DELIVERY_LAG_SCAN_LIMIT) {
        throw new Error(
          `notification delivery lag scanLimit must not exceed ${MAX_NOTIFICATION_DELIVERY_LAG_SCAN_LIMIT}`,
        )
      }
      const recordedAtOrAfter = window.recordedAtOrAfter.getTime()
      const recordedBefore = window.recordedBefore.getTime()
      if (
        !Number.isFinite(recordedAtOrAfter) ||
        !Number.isFinite(recordedBefore) ||
        recordedAtOrAfter >= recordedBefore
      ) {
        throw new Error(
          'notification delivery lag recordedAtOrAfter must precede recordedBefore',
        )
      }

      const source = await db.execute<PendingRow>(sql`
        WITH routes(event_type, consumer_name) AS (VALUES ${routeValues})
        SELECT count(*)::int AS pending, min(candidate.created_at) AS oldest
        FROM (
          SELECT event.created_at
          FROM ${outboxEvents} AS event
          JOIN routes ON routes.event_type = event.event_type
          WHERE event.created_at >= ${window.recordedAtOrAfter}::timestamptz
            AND event.created_at < ${window.recordedBefore}::timestamptz
            AND event.recovery_fenced_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM ${eventConsumerReceipts} AS receipt
              WHERE receipt.event_id = event.id
                AND receipt.consumer_name = routes.consumer_name
            )
          ORDER BY event.created_at, event.id
          LIMIT ${window.scanLimit}
        ) AS candidate
      `)

      const materialization = await db.execute<MaterializationPendingRow>(sql`
        WITH routes(event_type, consumer_name) AS (VALUES ${routeValues})
        SELECT
          count(*)::int AS pending,
          min(candidate.source_created_at) AS "oldestSource",
          min(candidate.enqueued_at) AS "oldestEnqueued"
        FROM (
          SELECT
            event.created_at AS source_created_at,
            enqueued.created_at AS enqueued_at
          FROM ${eventConsumerReceipts} AS enqueued
          JOIN ${outboxEvents} AS event ON event.id = enqueued.event_id
          JOIN routes
            ON routes.event_type = event.event_type
           AND split_part(enqueued.consumer_name, ':', 2) = routes.consumer_name
          WHERE event.created_at >= ${window.recordedAtOrAfter}::timestamptz
            AND event.created_at < ${window.recordedBefore}::timestamptz
            AND event.recovery_fenced_at IS NULL
            AND enqueued.consumer_name LIKE ${`${notificationDeliveryReceiptPrefixes.enqueue}%`}
            AND enqueued.status = 'applied'
            AND NOT EXISTS (
              SELECT 1
              FROM ${eventConsumerReceipts} AS materialized
              WHERE materialized.event_id = enqueued.event_id
                AND materialized.consumer_name = replace(
                  enqueued.consumer_name,
                  ${notificationDeliveryReceiptPrefixes.enqueue},
                  ${notificationDeliveryReceiptPrefixes.materialized}
                )
            )
          ORDER BY event.created_at, enqueued.event_id, enqueued.consumer_name
          LIMIT ${window.scanLimit}
        ) AS candidate
      `)

      const immediateEmailRows = await db.execute<ImmediateEmailAcceptanceRow>(sql`
        WITH
          routes(event_type, consumer_name) AS (VALUES ${routeValues}),
          active_types(notification_type) AS (VALUES ${activeNotificationTypeValues})
        SELECT
          email.status,
          email.last_error_class AS "lastErrorClass",
          email.retry_count AS "retryCount",
          email.attempted_at AS "attemptedAt",
          email.accepted_at AS "acceptedAt",
          CASE
            WHEN source_route.event_type IS NULL THEN NULL
            ELSE source_event.created_at
          END AS "sourceRecordedAt"
        FROM ${notificationEmailQueue} AS email
        JOIN ${notifications} AS notification
         ON notification.id = email.notification_id
         AND notification.organization_id = email.organization_id
         AND notification.user_id = email.user_id
         AND notification.property_id IS NOT DISTINCT FROM email.property_id
        JOIN active_types ON active_types.notification_type = notification.type
        LEFT JOIN ${outboxEvents} AS source_event
         ON source_event.id::text = notification.event_id
         AND source_event.organization_id = email.organization_id
         AND source_event.property_id IS NOT DISTINCT FROM email.property_id::text
        LEFT JOIN routes AS source_route
          ON source_route.event_type = source_event.event_type
        WHERE email.cadence = 'immediate'
          -- A non-null hold is an intentional quiet-hours/policy deferral,
          -- not a five-minute provider-acceptance candidate. The column is
          -- retained after acceptance, so deferred rows stay excluded from
          -- both the awaiting signal and the completed p99 sample.
          AND email.not_before IS NULL
          AND email.created_at >= ${window.recordedAtOrAfter}::timestamptz
          AND email.created_at < ${window.recordedBefore}::timestamptz
        ORDER BY email.created_at DESC, email.id
        LIMIT ${window.scanLimit + 1}
      `)

      const sourceRow = source.rows[0]
      const materializationRow = materialization.rows[0]
      const sourceReceiptPending = sourceRow?.pending ?? 0
      const materializationPending = materializationRow?.pending ?? 0
      const immediateEmailSaturated = immediateEmailRows.rows.length > window.scanLimit
      const immediateEmailSample = immediateEmailRows.rows.slice(0, window.scanLimit)
      const awaitingImmediateEmail = immediateEmailSample.filter(
        isAwaitingProviderAcceptance,
      )
      const acceptedLatencies = immediateEmailSample.flatMap((row) => {
        const acceptedAt = asDate(row.acceptedAt)
        const sourceRecordedAt = asDate(row.sourceRecordedAt)
        if (acceptedAt === null || sourceRecordedAt === null) return []
        return [Math.max(0, acceptedAt.getTime() - sourceRecordedAt.getTime())]
      })
      const linkedAwaitingSourceTimes = awaitingImmediateEmail
        .map((row) => asDate(row.sourceRecordedAt))
        .filter((value): value is Date => value !== null)
      return {
        sourceReceiptPending,
        materializationPending,
        oldestSourceRecordedAt: asDate(sourceRow?.oldest),
        oldestMaterializationSourceRecordedAt: asDate(materializationRow?.oldestSource),
        oldestMaterializationEnqueuedAt: asDate(materializationRow?.oldestEnqueued),
        sourceSaturated: sourceReceiptPending >= window.scanLimit,
        materializationSaturated: materializationPending >= window.scanLimit,
        immediateEmailAcceptance: {
          awaitingProviderAcceptance: awaitingImmediateEmail.length,
          attemptedAwaitingProviderAcceptance: awaitingImmediateEmail.filter(
            (row) => row.attemptedAt !== null,
          ).length,
          oldestAwaitingSourceRecordedAt:
            linkedAwaitingSourceTimes.length === 0
              ? null
              : new Date(
                  Math.min(...linkedAwaitingSourceTimes.map((value) => value.getTime())),
                ),
          acceptedLatencyP99Ms: immediateEmailSaturated
            ? null
            : nearestRankP99(acceptedLatencies),
          acceptedSampleCount: acceptedLatencies.length,
          sourceUnlinked: immediateEmailSample.filter(
            (row) => row.sourceRecordedAt === null,
          ).length,
          saturated: immediateEmailSaturated,
        },
      }
    },
  }
}
