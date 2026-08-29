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
import {
  primaryStaffAttributionEquals,
  type PrimaryStaffAttributionSnapshot,
} from '#/shared/domain/primary-staff-attribution'
import {
  portalLifetimeFactForMetric,
  type PortalLifetimeFact,
} from '../domain/portal-lifetime-aggregate'
import {
  applyPortalLifetimeChanges,
  type PortalLifetimeChange,
} from './portal-lifetime-aggregate-store'

type StaffAttributionColumns = Readonly<{
  attributedStaffParticipantId: string | null
  attributedStaffParticipationId: string | null
  attributionResponsibilityId: string | null
  staffAttributionEffectiveFrom: Date | null
  staffAttributionEffectiveTo: Date | null
}>

const staffAttributionFromColumns = (
  row: Partial<StaffAttributionColumns>,
): PrimaryStaffAttributionSnapshot | null =>
  row.attributedStaffParticipantId &&
  row.attributedStaffParticipationId &&
  row.attributionResponsibilityId &&
  row.staffAttributionEffectiveFrom
    ? {
        staffParticipantId: row.attributedStaffParticipantId,
        staffParticipationId: row.attributedStaffParticipationId,
        portalResponsibilityId: row.attributionResponsibilityId,
        effectiveFrom: row.staffAttributionEffectiveFrom,
        effectiveTo: row.staffAttributionEffectiveTo ?? null,
      }
    : null

const staffAttributionColumns = (
  attribution: PrimaryStaffAttributionSnapshot | null,
): StaffAttributionColumns => ({
  attributedStaffParticipantId: attribution?.staffParticipantId ?? null,
  attributedStaffParticipationId: attribution?.staffParticipationId ?? null,
  attributionResponsibilityId: attribution?.portalResponsibilityId ?? null,
  staffAttributionEffectiveFrom: attribution?.effectiveFrom ?? null,
  staffAttributionEffectiveTo: attribution?.effectiveTo ?? null,
})

const portalLifetimeFactsEqual = (
  left: PortalLifetimeFact | null | undefined,
  right: PortalLifetimeFact | null,
): boolean => JSON.stringify(left ?? null) === JSON.stringify(right)

type MetricTx = Parameters<Parameters<Database['transaction']>[0]>[0]

/** The negative lifetime contribution a superseded reading must give back. */
function priorPortalLifetimeRetraction(
  prior: Readonly<{
    metricKey: string
    exactValue: unknown
    portalDestinationKind: string | null
    propertyLocalDate: string | null
  }>,
): PortalLifetimeChange | null {
  if (prior.exactValue === null || prior.exactValue === undefined) return null
  const priorFact = portalLifetimeFactForMetric({
    metricKey: prior.metricKey,
    value: Number(prior.exactValue),
    destinationKind:
      prior.portalDestinationKind === 'google_review' ||
      prior.portalDestinationKind === 'secondary_link'
        ? prior.portalDestinationKind
        : null,
  })
  if (!priorFact) return null
  if (!prior.propertyLocalDate) {
    throw new Error('Portal lifetime source reading has no Property-local date')
  }
  return {
    fact: priorFact,
    multiplier: -1,
    propertyLocalDate: prior.propertyLocalDate,
  }
}

type SupersededReadingResolution =
  | Readonly<{ kind: 'quarantined' }>
  | Readonly<{
      kind: 'resolved'
      correctedReadingId: string
      correctedPortalLifetimeChange: PortalLifetimeChange | null
    }>

/**
 * Locate the reading a correction supersedes. A missing source reading is
 * quarantined rather than silently replaced.
 */
async function resolveSupersededReading(
  tx: MetricTx,
  command: RecordMetricCommand,
  supersedesSourceEventId: string,
): Promise<SupersededReadingResolution> {
  const prior = await tx
    .select({
      id: metricReadings.id,
      organizationId: metricReadings.organizationId,
      propertyId: metricReadings.propertyId,
      metricKey: metricReadings.metricKey,
      exactValue: metricReadings.exactValue,
      portalDestinationKind: metricReadings.portalDestinationKind,
      propertyLocalDate: metricReadings.propertyLocalDate,
      attributedStaffParticipantId: metricReadings.attributedStaffParticipantId,
      attributedStaffParticipationId: metricReadings.attributedStaffParticipationId,
      attributionResponsibilityId: metricReadings.attributionResponsibilityId,
      staffAttributionEffectiveFrom: metricReadings.staffAttributionEffectiveFrom,
      staffAttributionEffectiveTo: metricReadings.staffAttributionEffectiveTo,
    })
    .from(metricReadings)
    .where(
      and(
        eq(metricReadings.definitionVersionId, command.reading.definitionVersionId),
        eq(metricReadings.sourceEventId, supersedesSourceEventId),
        eq(metricReadings.organizationId, unbrand(command.reading.organizationId)),
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
  const priorRow = prior[0]
  const correctedReadingId = priorRow?.id ?? null
  const correctedStaffAttribution = priorRow
    ? staffAttributionFromColumns(priorRow)
    : null
  const correctedPortalLifetimeChange = priorRow
    ? priorPortalLifetimeRetraction(priorRow)
    : null

  if (!correctedReadingId) {
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          definitionVersionId: command.reading.definitionVersionId,
          sourceEventId: command.reading.sourceEventId,
          supersedesSourceEventId,
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
    return { kind: 'quarantined' }
  }

  if (
    !primaryStaffAttributionEquals(
      correctedStaffAttribution,
      command.reading.staffAttribution,
    )
  ) {
    throw new Error(
      'Replacement metric Staff attribution does not match its source reading',
    )
  }

  return {
    kind: 'resolved',
    correctedReadingId,
    correctedPortalLifetimeChange,
  }
}

/** The lifetime contribution this reading must carry, cross-checked with the command. */
function expectedPortalLifetimeFactFor(
  command: RecordMetricCommand,
): PortalLifetimeFact | null {
  const expectedPortalLifetimeFact = portalLifetimeFactForMetric({
    metricKey: command.reading.metricKey,
    value: command.reading.value,
    destinationKind: command.portalLifetimeFact?.destinationKind ?? null,
  })
  if (!portalLifetimeFactsEqual(command.portalLifetimeFact, expectedPortalLifetimeFact)) {
    throw new Error('Portal lifetime contribution does not match its reading')
  }
  if (expectedPortalLifetimeFact && command.reading.portalId === null) {
    throw new Error('Portal lifetime contribution has no Portal scope')
  }
  return expectedPortalLifetimeFact
}

type ReadingInsertion =
  Readonly<{ inserted: true }> | Readonly<{ inserted: false; existingReadingId: string }>

/**
 * Insert the governed reading. A conflicting row is only a duplicate when it
 * carries the same Staff attribution.
 */
async function insertReadingOrDescribeDuplicate(
  tx: MetricTx,
  command: RecordMetricCommand,
): Promise<ReadingInsertion> {
  const rows = await tx
    .insert(metricReadings)
    .values({
      id: unbrand(command.reading.id),
      organizationId: unbrand(command.reading.organizationId),
      propertyId: unbrand(command.reading.propertyId),
      portalId: command.reading.portalId ? unbrand(command.reading.portalId) : null,
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
      portalDestinationKind: command.portalLifetimeFact?.destinationKind ?? null,
      ...staffAttributionColumns(command.reading.staffAttribution),
    })
    .onConflictDoNothing()
    .returning({ id: metricReadings.id })
  if (rows[0]) return { inserted: true }

  const existing = await tx
    .select({
      id: metricReadings.id,
      attributedStaffParticipantId: metricReadings.attributedStaffParticipantId,
      attributedStaffParticipationId: metricReadings.attributedStaffParticipationId,
      attributionResponsibilityId: metricReadings.attributionResponsibilityId,
      staffAttributionEffectiveFrom: metricReadings.staffAttributionEffectiveFrom,
      staffAttributionEffectiveTo: metricReadings.staffAttributionEffectiveTo,
    })
    .from(metricReadings)
    .where(
      and(
        eq(metricReadings.definitionVersionId, command.reading.definitionVersionId),
        eq(metricReadings.sourceEventId, command.reading.sourceEventId),
      ),
    )
    .limit(1)
  if (
    existing[0] &&
    !primaryStaffAttributionEquals(
      staffAttributionFromColumns(existing[0]),
      command.reading.staffAttribution,
    )
  ) {
    throw new Error('Duplicate metric reading Staff attribution does not match')
  }
  return {
    inserted: false,
    existingReadingId: existing[0]?.id ?? unbrand(command.reading.id),
  }
}

/** Retract the superseded reading and describe the correction for the outbox. */
async function recordRetractionCorrection(
  tx: MetricTx,
  correctionId: string,
  command: RecordMetricCommand,
  correctedReadingId: string,
  supersedesSourceEventId: string,
): Promise<MetricCorrected> {
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
    ...staffAttributionColumns(command.reading.staffAttribution),
  })
  return metricCorrected({
    correctionId,
    correctedReadingId: metricReadingId(correctedReadingId),
    replacementReadingId: command.reading.id,
    organizationId: command.reading.organizationId,
    propertyId: command.reading.propertyId,
    definitionVersionId: command.reading.definitionVersionId,
    sourceEventId: command.reading.sourceEventId,
    supersededSourceEventId: supersedesSourceEventId,
    occurredAt: command.reading.occurredAt,
    staffAttribution: command.reading.staffAttribution,
  })
}

export const createAtomicMetricCommandStore = (
  db: Database,
  events: EventBus,
  idGen: () => string,
): MetricCommandStore => {
  return {
    recordMetric: async (command: RecordMetricCommand): Promise<ReadingResult> =>
      trace('metric.commandStore.recordMetric', async () => {
        if (
          !primaryStaffAttributionEquals(
            command.reading.staffAttribution,
            command.event.staffAttribution,
          )
        ) {
          throw new Error('Metric fact Staff attribution does not match its reading')
        }
        const committed = await db.transaction(async (tx) => {
          const superseded = command.supersedesSourceEventId
            ? await resolveSupersededReading(tx, command, command.supersedesSourceEventId)
            : null
          if (superseded?.kind === 'quarantined') {
            return {
              result: {
                status: 'quarantined' as const,
                reason: 'superseded_reading_not_found',
                sourceEventId: command.reading.sourceEventId,
              },
              correctionEvent: null,
            }
          }
          const correctedReadingId = superseded?.correctedReadingId ?? null
          const correctedPortalLifetimeChange =
            superseded?.correctedPortalLifetimeChange ?? null

          const expectedPortalLifetimeFact = expectedPortalLifetimeFactFor(command)

          const insertion = await insertReadingOrDescribeDuplicate(tx, command)
          if (!insertion.inserted) {
            return {
              result: {
                status: 'duplicate' as const,
                existingReadingId: insertion.existingReadingId,
              },
              correctionEvent: null,
            }
          }

          let correctionEvent: MetricCorrected | null = null
          if (correctedReadingId && command.supersedesSourceEventId) {
            correctionEvent = await recordRetractionCorrection(
              tx,
              idGen(),
              command,
              correctedReadingId,
              command.supersedesSourceEventId,
            )
          }

          if (expectedPortalLifetimeFact && command.reading.portalId) {
            await applyPortalLifetimeChanges(
              tx as unknown as Database,
              {
                organizationId: command.reading.organizationId,
                propertyId: command.reading.propertyId,
                portalId: command.reading.portalId,
              },
              [
                ...(correctedPortalLifetimeChange ? [correctedPortalLifetimeChange] : []),
                {
                  fact: expectedPortalLifetimeFact,
                  multiplier: 1,
                  propertyLocalDate: command.reading.propertyLocalDate,
                },
              ],
            )
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
            .select({
              readingId: metricCorrections.readingId,
              attributedStaffParticipantId:
                metricCorrections.attributedStaffParticipantId,
              attributedStaffParticipationId:
                metricCorrections.attributedStaffParticipationId,
              attributionResponsibilityId: metricCorrections.attributionResponsibilityId,
              staffAttributionEffectiveFrom:
                metricCorrections.staffAttributionEffectiveFrom,
              staffAttributionEffectiveTo: metricCorrections.staffAttributionEffectiveTo,
            })
            .from(metricCorrections)
            .where(eq(metricCorrections.sourceEventId, correctionSourceEventId))
            .limit(1)
          if (duplicate[0]) {
            if (
              !primaryStaffAttributionEquals(
                staffAttributionFromColumns(duplicate[0]),
                command.staffAttribution,
              )
            ) {
              throw new Error(
                'Duplicate metric correction Staff attribution does not match',
              )
            }
            return {
              result: {
                status: 'duplicate' as const,
                correctedReadingId: duplicate[0].readingId,
              },
              event: null,
            }
          }

          const target = await tx
            .select({
              id: metricReadings.id,
              attributedStaffParticipantId: metricReadings.attributedStaffParticipantId,
              attributedStaffParticipationId:
                metricReadings.attributedStaffParticipationId,
              attributionResponsibilityId: metricReadings.attributionResponsibilityId,
              staffAttributionEffectiveFrom: metricReadings.staffAttributionEffectiveFrom,
              staffAttributionEffectiveTo: metricReadings.staffAttributionEffectiveTo,
              metricKey: metricReadings.metricKey,
              exactValue: metricReadings.exactValue,
              portalDestinationKind: metricReadings.portalDestinationKind,
              propertyLocalDate: metricReadings.propertyLocalDate,
            })
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
          const targetStaffAttribution = staffAttributionFromColumns(target[0])
          if (
            !primaryStaffAttributionEquals(
              targetStaffAttribution,
              command.staffAttribution,
            )
          ) {
            throw new Error(
              'Metric retraction Staff attribution does not match its source reading',
            )
          }

          const correctionId = idGen()
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
              ...staffAttributionColumns(targetStaffAttribution),
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
            staffAttribution: targetStaffAttribution,
          })
          if (target[0].exactValue !== null) {
            const fact = portalLifetimeFactForMetric({
              metricKey: target[0].metricKey,
              value: Number(target[0].exactValue),
              destinationKind:
                target[0].portalDestinationKind === 'google_review' ||
                target[0].portalDestinationKind === 'secondary_link'
                  ? target[0].portalDestinationKind
                  : null,
            })
            if (fact) {
              if (!target[0].propertyLocalDate) {
                throw new Error(
                  'Portal lifetime source reading has no Property-local date',
                )
              }
              await applyPortalLifetimeChanges(
                tx as unknown as Database,
                {
                  organizationId: command.organizationId,
                  propertyId: command.propertyId,
                  portalId: command.portalId,
                },
                [
                  {
                    fact,
                    multiplier: -1,
                    propertyLocalDate: target[0].propertyLocalDate,
                  },
                ],
              )
            }
          }
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
