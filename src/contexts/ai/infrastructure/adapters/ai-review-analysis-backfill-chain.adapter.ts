import type { JobsOptions } from 'bullmq'
import { z } from 'zod/v4'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import type { UnpublishedEvent } from '#/shared/outbox/infrastructure/outbox-repository'
import { DISPATCH_JOB_OPTIONS } from '#/shared/outbox/dispatch-job-options'
import {
  AI_REVIEW_ANALYSIS_BACKFILL_EVENT,
  AI_REVIEW_ANALYSIS_CONSUMER,
} from '../outbox-consumers'

const uuidSchema = z.uuid()

export type ReviewAnalysisBackfillChainQueue = Readonly<{
  add: (name: string, data: unknown, options: JobsOptions) => Promise<unknown>
}>

export type AdvanceReviewAnalysisBackfillInput = Readonly<{
  eventId: string
  organizationId: string
  propertyId: string
  correlationId: string | null
  analysisSequence: number
}>

export type AdvanceReviewAnalysisBackfillResult =
  | Readonly<{ status: 'enqueued'; successorSequence: number }>
  | Readonly<{
      status: 'stopped'
      reason:
        | 'invalid_envelope'
        | 'queue_unavailable'
        | 'no_successor'
        | 'ambiguous_successor'
        | 'lookup_failed'
        | 'enqueue_failed'
    }>

type SuccessorRow = Readonly<{
  id: string
  event_type: string
  event_version: number
  payload: unknown
  organization_id: string
  property_id: string | null
  source_context: string
  source_aggregate_id: string
  recorded_at_ms: number
}>

function mapSuccessor(row: SuccessorRow): UnpublishedEvent | null {
  if (
    !uuidSchema.safeParse(row.id).success ||
    row.event_type !== AI_REVIEW_ANALYSIS_BACKFILL_EVENT ||
    !Number.isSafeInteger(row.event_version) ||
    typeof row.organization_id !== 'string' ||
    (row.property_id !== null && typeof row.property_id !== 'string') ||
    typeof row.source_context !== 'string' ||
    typeof row.source_aggregate_id !== 'string' ||
    !Number.isFinite(row.recorded_at_ms)
  ) {
    return null
  }
  return {
    id: row.id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    payload: row.payload,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    sourceContext: row.source_context,
    sourceAggregateId: row.source_aggregate_id,
    recordedAt: new Date(row.recorded_at_ms),
  }
}

export function createReviewAnalysisBackfillChainAdapter(input: {
  db: Database
  queue: ReviewAnalysisBackfillChainQueue | undefined
  logger: Pick<LoggerPort, 'warn'>
}): (
  command: AdvanceReviewAnalysisBackfillInput,
) => Promise<AdvanceReviewAnalysisBackfillResult> {
  return async (command) => {
    if (
      !uuidSchema.safeParse(command.eventId).success ||
      !uuidSchema.safeParse(command.propertyId).success ||
      !uuidSchema.safeParse(command.correlationId).success ||
      !Number.isSafeInteger(command.analysisSequence) ||
      command.analysisSequence < 1
    ) {
      return { status: 'stopped', reason: 'invalid_envelope' }
    }
    if (!input.queue) {
      input.logger.warn(
        { eventType: AI_REVIEW_ANALYSIS_BACKFILL_EVENT, reason: 'queue_unavailable' },
        'Review Analysis backfill successor wake deferred to durable redelivery',
      )
      return { status: 'stopped', reason: 'queue_unavailable' }
    }

    const successorSequence = command.analysisSequence + 1
    let rows: readonly SuccessorRow[]
    try {
      const result = await input.db.execute(sql<SuccessorRow>`
        WITH current_chain AS (
          SELECT enrollment.source_epoch, enrollment.review_analysis_epoch
          FROM ai_review_analysis_enrollments AS enrollment
          INNER JOIN merchant_ai_enablement AS enablement
            ON enablement.organization_id = enrollment.organization_id
           AND enablement.property_id = enrollment.property_id
           AND enablement.authorization_lineage_id = enrollment.authorization_lineage_id
           AND enablement.state_version = enrollment.authorization_state_version
           AND enablement.authorized_source_epoch = enrollment.source_epoch
           AND enablement.review_analysis_epoch = enrollment.review_analysis_epoch
           AND enablement.analysis_start_sequence = enrollment.analysis_start_sequence
          WHERE enrollment.id = ${command.correlationId}::uuid
            AND enrollment.organization_id = ${command.organizationId}
            AND enrollment.property_id = ${command.propertyId}::uuid
            AND enrollment.state = 'running'
            AND enablement.state = 'enabled'
            AND 'review_analysis' = ANY(enablement.capabilities)
            AND EXISTS (
              SELECT 1
              FROM ai_property_aggregate_heads AS head
              WHERE head.organization_id = enrollment.organization_id
                AND head.property_id = enrollment.property_id
                AND head.source_epoch = enrollment.source_epoch
                AND head.review_analysis_epoch = enrollment.review_analysis_epoch
                AND head.terminal_analysis_sequence >= ${command.analysisSequence}
            )
            AND EXISTS (
              SELECT 1
              FROM outbox_events AS current_event
              WHERE current_event.id = ${command.eventId}::uuid
                AND current_event.event_type = ${AI_REVIEW_ANALYSIS_BACKFILL_EVENT}
                AND current_event.organization_id = enrollment.organization_id
                AND current_event.property_id = enrollment.property_id::text
                AND current_event.payload->>'correlationId' = enrollment.id::text
                AND current_event.payload->>'analysisSequence' = ${String(command.analysisSequence)}
                AND current_event.payload->>'sourceEpoch' = enrollment.source_epoch::text
                AND EXISTS (
                  SELECT 1
                  FROM event_consumer_receipts AS current_receipt
                  WHERE current_receipt.event_id = current_event.id
                    AND current_receipt.consumer_name = ${AI_REVIEW_ANALYSIS_CONSUMER}
                )
            )
        )
        SELECT successor.id,
               successor.event_type,
               successor.event_version,
               successor.payload,
               successor.organization_id,
               successor.property_id,
               successor.source_context,
               successor.source_aggregate_id,
               (EXTRACT(EPOCH FROM successor.created_at) * 1000)::float8
                 AS recorded_at_ms
        FROM outbox_events AS successor
        CROSS JOIN current_chain AS chain
        WHERE successor.event_type = ${AI_REVIEW_ANALYSIS_BACKFILL_EVENT}
          AND successor.organization_id = ${command.organizationId}
          AND successor.property_id = ${command.propertyId}
          AND successor.published_at IS NOT NULL
          AND successor.recovery_fenced_at IS NULL
          AND successor.payload->>'correlationId' = ${command.correlationId}
          AND successor.payload->>'sourceEpoch' = chain.source_epoch::text
          AND successor.payload->>'analysisSequence' = ${String(successorSequence)}
          AND NOT EXISTS (
            SELECT 1
            FROM event_consumer_receipts AS receipt
            WHERE receipt.event_id = successor.id
              AND receipt.consumer_name = ${AI_REVIEW_ANALYSIS_CONSUMER}
          )
        ORDER BY successor.created_at, successor.id
        LIMIT 2
      `)
      rows = result.rows as unknown as readonly SuccessorRow[]
    } catch {
      input.logger.warn(
        { eventType: AI_REVIEW_ANALYSIS_BACKFILL_EVENT, reason: 'lookup_failed' },
        'Review Analysis backfill successor wake deferred to durable redelivery',
      )
      return { status: 'stopped', reason: 'lookup_failed' }
    }

    if (rows.length === 0) return { status: 'stopped', reason: 'no_successor' }
    if (rows.length !== 1) {
      input.logger.warn(
        { eventType: AI_REVIEW_ANALYSIS_BACKFILL_EVENT, reason: 'ambiguous_successor' },
        'Review Analysis backfill successor wake refused',
      )
      return { status: 'stopped', reason: 'ambiguous_successor' }
    }
    const successor = mapSuccessor(rows[0]!)
    if (!successor) {
      input.logger.warn(
        { eventType: AI_REVIEW_ANALYSIS_BACKFILL_EVENT, reason: 'lookup_failed' },
        'Review Analysis backfill successor wake deferred to durable redelivery',
      )
      return { status: 'stopped', reason: 'lookup_failed' }
    }

    try {
      await input.queue.add(successor.eventType, buildConsumerEvent(successor), {
        jobId: `${successor.id}-chain-after-${command.eventId}`,
        ...DISPATCH_JOB_OPTIONS,
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
      })
    } catch {
      input.logger.warn(
        { eventType: AI_REVIEW_ANALYSIS_BACKFILL_EVENT, reason: 'enqueue_failed' },
        'Review Analysis backfill successor wake deferred to durable redelivery',
      )
      return { status: 'stopped', reason: 'enqueue_failed' }
    }
    return { status: 'enqueued', successorSequence }
  }
}
