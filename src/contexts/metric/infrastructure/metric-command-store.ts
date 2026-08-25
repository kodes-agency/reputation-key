import { createHash } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  metricCorrections,
  metricQuarantine,
  metricReadings,
} from '#/shared/db/schema/metric.schema'
import type { EventBus } from '#/shared/events/event-bus'
import { emitAfterCommit, insertOutboxRow } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { metricReadingId, unbrand } from '#/shared/domain/ids'
import type { ReadingResult } from '../domain/metric-reading'
import { metricCorrected, type MetricCorrected } from '../domain/events'
import type {
  MetricCommandStore,
  QuarantineMetricCommand,
  RecordMetricCommand,
} from '../application/ports/metric-command-store.port'

export function createAtomicMetricCommandStore(
  db: Database,
  events: EventBus,
): MetricCommandStore {
  return {
    recordMetric: async (command: RecordMetricCommand): Promise<ReadingResult> =>
      trace('metric.commandStore.recordMetric', async () => {
        const committed = await db.transaction(async (tx) => {
          let correctedReadingId: string | null = null
          if (command.supersedesSourceEventId) {
            const prior = await tx
              .select({
                id: metricReadings.id,
                organizationId: metricReadings.organizationId,
                propertyId: metricReadings.propertyId,
              })
              .from(metricReadings)
              .where(
                and(
                  eq(
                    metricReadings.definitionVersionId,
                    command.reading.definitionVersionId,
                  ),
                  eq(metricReadings.sourceEventId, command.supersedesSourceEventId),
                  eq(
                    metricReadings.organizationId,
                    unbrand(command.reading.organizationId),
                  ),
                  eq(metricReadings.propertyId, unbrand(command.reading.propertyId)),
                  command.reading.portalId
                    ? eq(metricReadings.portalId, unbrand(command.reading.portalId))
                    : isNull(metricReadings.portalId),
                  command.reading.portalGroupId
                    ? eq(metricReadings.groupId, unbrand(command.reading.portalGroupId))
                    : isNull(metricReadings.groupId),
                ),
              )
              .limit(1)
            correctedReadingId = prior[0]?.id ?? null
            if (!correctedReadingId) {
              const payloadHash = createHash('sha256')
                .update(
                  JSON.stringify({
                    definitionVersionId: command.reading.definitionVersionId,
                    sourceEventId: command.reading.sourceEventId,
                    supersedesSourceEventId: command.supersedesSourceEventId,
                    organizationId: command.reading.organizationId,
                    propertyId: command.reading.propertyId,
                  }),
                )
                .digest('hex')
              await tx
                .insert(metricQuarantine)
                .values({
                  sourceEventId: command.reading.sourceEventId,
                  organizationId: unbrand(command.reading.organizationId),
                  propertyId: unbrand(command.reading.propertyId),
                  definitionVersionId: command.reading.definitionVersionId,
                  sourcePolicy: command.reading.sourcePolicy,
                  reason: 'superseded_reading_not_found',
                  payloadHash,
                  eventAt: command.reading.occurredAt,
                })
                .onConflictDoNothing()
              return {
                result: {
                  status: 'quarantined' as const,
                  reason: 'superseded_reading_not_found',
                  sourceEventId: command.reading.sourceEventId,
                },
                correctionEvent: null,
              }
            }
          }

          const rows = await tx
            .insert(metricReadings)
            .values({
              id: unbrand(command.reading.id),
              organizationId: unbrand(command.reading.organizationId),
              propertyId: unbrand(command.reading.propertyId),
              portalId: command.reading.portalId
                ? unbrand(command.reading.portalId)
                : null,
              groupId: command.reading.portalGroupId
                ? unbrand(command.reading.portalGroupId)
                : null,
              metricKey: command.reading.metricKey,
              value: command.reading.value,
              definitionVersionId: command.reading.definitionVersionId,
              sourceEventId: command.reading.sourceEventId,
              sourcePolicy: command.reading.sourcePolicy,
              exactValue: command.reading.value,
              numerator: command.reading.numerator,
              denominator: command.reading.denominator,
              sampleCount: command.reading.sampleCount,
              attributionQuality: command.reading.attributionQuality,
              eventAt: command.reading.occurredAt,
              occurredAt: command.reading.recordedAt,
              propertyLocalDate: command.reading.propertyLocalDate,
              dataQuality: command.reading.dataQuality,
              retentionClass: command.reading.retentionClass,
            })
            .onConflictDoNothing()
            .returning({ id: metricReadings.id })

          if (!rows[0]) {
            const existing = await tx
              .select({ id: metricReadings.id })
              .from(metricReadings)
              .where(
                and(
                  eq(
                    metricReadings.definitionVersionId,
                    command.reading.definitionVersionId,
                  ),
                  eq(metricReadings.sourceEventId, command.reading.sourceEventId),
                ),
              )
              .limit(1)
            return {
              result: {
                status: 'duplicate' as const,
                existingReadingId: existing[0]?.id ?? unbrand(command.reading.id),
              },
              correctionEvent: null,
            }
          }

          let correctionEvent: MetricCorrected | null = null
          if (correctedReadingId && command.supersedesSourceEventId) {
            const correctionId = crypto.randomUUID()
            await tx.insert(metricCorrections).values({
              id: correctionId,
              readingId: correctedReadingId,
              sourceEventId: `${command.reading.sourceEventId}:retract`,
              kind: 'retract',
              reason: 'source_reconciliation',
              actorType: 'system',
              actorId: 'portal-workflow',
              exactDelta: null,
              replacementValue: null,
              eventAt: command.reading.occurredAt,
              supersedesCorrectionId: null,
              recordedAt: command.reading.recordedAt,
            })
            correctionEvent = metricCorrected({
              correctionId,
              correctedReadingId: metricReadingId(correctedReadingId),
              replacementReadingId: command.reading.id,
              organizationId: command.reading.organizationId,
              propertyId: command.reading.propertyId,
              definitionVersionId: command.reading.definitionVersionId,
              sourceEventId: command.reading.sourceEventId,
              supersededSourceEventId: command.supersedesSourceEventId,
              occurredAt: command.reading.occurredAt,
            })
          }

          await insertOutboxRow(tx, command.event)
          if (correctionEvent) await insertOutboxRow(tx, correctionEvent)
          return {
            result: { status: 'recorded' as const, reading: command.reading },
            correctionEvent,
          }
        })

        if (committed.result.status === 'recorded') {
          await emitAfterCommit(events, command.event)
          if (committed.correctionEvent) {
            await emitAfterCommit(events, committed.correctionEvent)
          }
        }
        return committed.result
      }),

    retractMetric: async (command) =>
      trace('metric.commandStore.retractMetric', async () => {
        const correctionSourceEventId = `${command.sourceEventId}:${command.definitionVersionId}`
        const committed = await db.transaction(async (tx) => {
          const duplicate = await tx
            .select({ readingId: metricCorrections.readingId })
            .from(metricCorrections)
            .where(eq(metricCorrections.sourceEventId, correctionSourceEventId))
            .limit(1)
          if (duplicate[0]) {
            return {
              result: {
                status: 'duplicate' as const,
                correctedReadingId: duplicate[0].readingId,
              },
              event: null,
            }
          }

          const target = await tx
            .select({ id: metricReadings.id })
            .from(metricReadings)
            .where(
              and(
                eq(metricReadings.organizationId, unbrand(command.organizationId)),
                eq(metricReadings.propertyId, unbrand(command.propertyId)),
                eq(metricReadings.portalId, unbrand(command.portalId)),
                eq(metricReadings.definitionVersionId, command.definitionVersionId),
                eq(metricReadings.sourceEventId, command.supersedesSourceEventId),
              ),
            )
            .limit(1)
          if (!target[0]) {
            return {
              result: { status: 'source_reading_not_found' as const },
              event: null,
            }
          }

          const correctionId = crypto.randomUUID()
          const inserted = await tx
            .insert(metricCorrections)
            .values({
              id: correctionId,
              readingId: target[0].id,
              sourceEventId: correctionSourceEventId,
              kind: 'retract',
              reason: 'guest_fact_retracted',
              actorType: 'system',
              actorId: 'guest.gateway',
              exactDelta: null,
              replacementValue: null,
              eventAt: command.occurredAt,
              supersedesCorrectionId: null,
              recordedAt: command.occurredAt,
            })
            .onConflictDoNothing()
            .returning({ id: metricCorrections.id })
          if (!inserted[0]) {
            throw new Error('metric retraction lost a conflicting correction race')
          }

          const event = metricCorrected({
            correctionId,
            correctedReadingId: metricReadingId(target[0].id),
            replacementReadingId: null,
            organizationId: command.organizationId,
            propertyId: command.propertyId,
            definitionVersionId: command.definitionVersionId,
            sourceEventId: command.sourceEventId,
            supersededSourceEventId: command.supersedesSourceEventId,
            occurredAt: command.occurredAt,
          })
          await insertOutboxRow(tx, event)
          return {
            result: {
              status: 'retracted' as const,
              correctedReadingId: target[0].id,
            },
            event,
          }
        })
        if (committed.event) await emitAfterCommit(events, committed.event)
        return committed.result
      }),

    quarantine: async (command: QuarantineMetricCommand): Promise<void> =>
      trace('metric.commandStore.quarantine', async () => {
        await db
          .insert(metricQuarantine)
          .values({
            sourceEventId: command.sourceEventId,
            organizationId: command.organizationId,
            propertyId: command.propertyId,
            definitionVersionId: command.definitionVersionId,
            sourcePolicy: command.sourcePolicy,
            reason: command.reason,
            payloadHash: command.payloadHash,
            eventAt: command.eventAt,
          })
          .onConflictDoNothing()
      }),
  }
}
