import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { metricCorrections, metricReadings } from '#/shared/db/schema/metric.schema'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { metricReadingId, unbrand } from '#/shared/domain/ids'
import type { ReadingResult } from '../domain/metric-reading'
import { metricCorrected, type MetricCorrected } from '../domain/events'
import type {
  MetricCommandStore,
  MetricSourceReceipt,
  RecordMetricCommand,
  RecordMetricEntry,
  RecordMetricsCommand,
  RetractMetricCommand,
  RetractMetricResult,
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
  | Readonly<{ kind: 'rejected' }>
  | Readonly<{
      kind: 'resolved'
      correctedReadingId: string
      correctedPortalLifetimeChange: PortalLifetimeChange | null
    }>

/**
 * Locate the reading a correction supersedes. A missing source reading is
 * rejected rather than silently replaced.
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

  if (!correctedReadingId) return { kind: 'rejected' }

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

async function existingReadingId(
  tx: MetricTx,
  command: RecordMetricCommand,
): Promise<string | null> {
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
        eq(metricReadings.organizationId, unbrand(command.reading.organizationId)),
        eq(metricReadings.propertyId, unbrand(command.reading.propertyId)),
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
  return existing[0]?.id ?? null
}

async function reserveSourceReceipt(
  tx: MetricTx,
  receipt: MetricSourceReceipt,
): Promise<boolean> {
  const rows = await tx
    .insert(eventConsumerReceipts)
    .values({
      eventId: receipt.eventId,
      consumerName: receipt.consumerName,
      status: 'applied',
    })
    .onConflictDoNothing({
      target: [eventConsumerReceipts.eventId, eventConsumerReceipts.consumerName],
    })
    .returning({ eventId: eventConsumerReceipts.eventId })
  return rows.length === 1
}

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

  const existingId = await existingReadingId(tx, command)
  if (!existingId) {
    throw new Error('Metric reading insert conflicted without an existing source reading')
  }
  return { inserted: false, existingReadingId: existingId }
}

/**
 * Retract the superseded reading and describe the correction for the outbox.
 *
 * The insert is idempotent on the correction's source key, matching the reading
 * insert above. Delivery is at-least-once, so a redelivery reaches here whenever
 * the reading it supersedes is absent — a retry, or a reading a retention purge
 * removed between deliveries. Without this the second insert raised
 * `metric_corrections_source_unique`, the outbox job failed all four attempts,
 * and the whole domain-events queue stopped making progress: every downstream
 * projection then timed out for reasons that looked nothing like this.
 *
 * On conflict the existing correction ID is reused rather than the freshly
 * generated one, so a replay records the same fact as the first delivery
 * instead of describing a second correction that was never written.
 */
async function recordRetractionCorrection(
  tx: MetricTx,
  correctionId: string,
  command: RecordMetricCommand,
  correctedReadingId: string,
  supersedesSourceEventId: string,
): Promise<MetricCorrected> {
  const correctionSourceEventId = `${command.reading.sourceEventId}:retract`
  const inserted = await tx
    .insert(metricCorrections)
    .values({
      id: correctionId,
      readingId: correctedReadingId,
      sourceEventId: correctionSourceEventId,
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
    .onConflictDoNothing()
    .returning({ id: metricCorrections.id })

  const effectiveCorrectionId = inserted[0]?.id ?? (await existingCorrectionId())

  async function existingCorrectionId(): Promise<string> {
    const [row] = await tx
      .select({ id: metricCorrections.id })
      .from(metricCorrections)
      .where(eq(metricCorrections.sourceEventId, correctionSourceEventId))
      .limit(1)
    if (!row) {
      // Nothing inserted and nothing there: the conflict was on some other
      // constraint, and inventing an ID would record a fact for a correction
      // that does not exist.
      throw new Error(
        `Metric retraction correction ${correctionSourceEventId} was neither inserted nor found`,
      )
    }
    return row.id
  }

  return metricCorrected({
    correctionId: effectiveCorrectionId,
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

async function recordMetricEntry(
  tx: MetricTx,
  command: RecordMetricEntry,
  idGen: () => string,
): Promise<ReadingResult> {
  const superseded = command.supersedesSourceEventId
    ? await resolveSupersededReading(tx, command, command.supersedesSourceEventId)
    : null
  if (superseded?.kind === 'rejected') {
    return {
      status: 'rejected',
      reason: 'superseded_reading_not_found',
      sourceEventId: command.reading.sourceEventId,
    }
  }
  const correctedReadingId = superseded?.correctedReadingId ?? null
  const correctedPortalLifetimeChange = superseded?.correctedPortalLifetimeChange ?? null
  const expectedPortalLifetimeFact = expectedPortalLifetimeFactFor(command)
  const insertion = await insertReadingOrDescribeDuplicate(tx, command)
  if (!insertion.inserted) {
    return {
      status: 'duplicate',
      existingReadingId: insertion.existingReadingId,
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
  return { status: 'recorded', reading: command.reading }
}

type DuplicateRetractionResult = Extract<
  RetractMetricResult,
  Readonly<{ status: 'duplicate' }>
>

async function existingRetractionResult(
  tx: MetricTx,
  command: RetractMetricCommand,
): Promise<DuplicateRetractionResult | null> {
  const correctionSourceEventId = `${command.sourceEventId}:${command.definitionVersionId}`
  const duplicate = await tx
    .select({
      readingId: metricCorrections.readingId,
      attributedStaffParticipantId: metricCorrections.attributedStaffParticipantId,
      attributedStaffParticipationId: metricCorrections.attributedStaffParticipationId,
      attributionResponsibilityId: metricCorrections.attributionResponsibilityId,
      staffAttributionEffectiveFrom: metricCorrections.staffAttributionEffectiveFrom,
      staffAttributionEffectiveTo: metricCorrections.staffAttributionEffectiveTo,
    })
    .from(metricCorrections)
    .where(eq(metricCorrections.sourceEventId, correctionSourceEventId))
    .limit(1)
  if (!duplicate[0]) return null
  if (
    !primaryStaffAttributionEquals(
      staffAttributionFromColumns(duplicate[0]),
      command.staffAttribution,
    )
  ) {
    throw new Error('Duplicate metric correction Staff attribution does not match')
  }
  return {
    status: 'duplicate',
    correctedReadingId: duplicate[0].readingId,
  }
}

async function retractMetricEntry(
  tx: MetricTx,
  command: RetractMetricCommand,
  idGen: () => string,
  knownDuplicate?: DuplicateRetractionResult | null,
): Promise<RetractMetricResult> {
  const correctionSourceEventId = `${command.sourceEventId}:${command.definitionVersionId}`
  const duplicate =
    knownDuplicate === undefined
      ? await existingRetractionResult(tx, command)
      : knownDuplicate
  if (duplicate) return duplicate

  const target = await tx
    .select({
      id: metricReadings.id,
      attributedStaffParticipantId: metricReadings.attributedStaffParticipantId,
      attributedStaffParticipationId: metricReadings.attributedStaffParticipationId,
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
  if (!target[0]) return { status: 'source_reading_not_found' }
  const targetStaffAttribution = staffAttributionFromColumns(target[0])
  if (!primaryStaffAttributionEquals(targetStaffAttribution, command.staffAttribution)) {
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
        throw new Error('Portal lifetime source reading has no Property-local date')
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
    status: 'retracted',
    correctedReadingId: target[0].id,
  }
}

function retractionReceipt(
  commands: readonly RetractMetricCommand[],
  explicitReceipt?: MetricSourceReceipt,
): MetricSourceReceipt | undefined {
  let receipt = explicitReceipt
  for (const command of commands) {
    if (!command.sourceReceipt) continue
    if (
      receipt &&
      (receipt.eventId !== command.sourceReceipt.eventId ||
        receipt.consumerName !== command.sourceReceipt.consumerName)
    ) {
      throw new Error('Metric retraction source receipts do not match')
    }
    receipt = command.sourceReceipt
  }
  return receipt
}

export const createAtomicMetricCommandStore = (
  db: Database,
  idGen: () => string,
): MetricCommandStore => {
  const recordMetrics = async (
    command: RecordMetricsCommand,
  ): Promise<readonly ReadingResult[]> =>
    trace('metric.commandStore.recordMetrics', async () => {
      if (command.readings.length === 0) {
        if (command.sourceReceipt) {
          throw new Error('Metric source receipt has no readings')
        }
        return []
      }
      for (const reading of command.readings) {
        if (
          !primaryStaffAttributionEquals(
            reading.reading.staffAttribution,
            reading.event.staffAttribution,
          )
        ) {
          throw new Error('Metric fact Staff attribution does not match its reading')
        }
        if (
          command.sourceReceipt &&
          command.sourceReceipt.eventId !== reading.reading.sourceEventId
        ) {
          throw new Error('Metric source receipt event does not match its reading')
        }
      }

      const committed = await db.transaction(async (tx) => {
        const priorReadingIds: Array<string | null> = command.readings.map(() => null)
        if (
          command.sourceReceipt &&
          !(await reserveSourceReceipt(tx, command.sourceReceipt))
        ) {
          let found = false
          for (const [index, reading] of command.readings.entries()) {
            const existingId = await existingReadingId(tx, reading)
            priorReadingIds[index] = existingId
            found ||= existingId !== null
          }
          if (!found) {
            throw new Error('Metric source receipt exists without its source reading')
          }
        }

        const results: ReadingResult[] = []
        for (const [index, reading] of command.readings.entries()) {
          const existingId = priorReadingIds[index]
          if (existingId) {
            results.push({
              status: 'duplicate',
              existingReadingId: existingId,
            })
            continue
          }
          const result = await recordMetricEntry(tx, reading, idGen)
          if (command.sourceReceipt && result.status === 'rejected') {
            throw new Error('Metric reading is not available for replacement')
          }
          results.push(result)
        }
        return results
      })

      return committed
    })

  const retractMetrics = async (
    commands: readonly RetractMetricCommand[],
    explicitReceipt?: MetricSourceReceipt,
  ): Promise<readonly RetractMetricResult[]> =>
    trace('metric.commandStore.retractMetrics', async () => {
      const sourceReceipt = retractionReceipt(commands, explicitReceipt)
      if (commands.length === 0) {
        if (sourceReceipt) {
          throw new Error('Metric retraction source receipt has no corrections')
        }
        return []
      }
      if (
        sourceReceipt &&
        commands.some((command) => command.sourceEventId !== sourceReceipt.eventId)
      ) {
        throw new Error('Metric source receipt event does not match its retraction')
      }

      const committed = await db.transaction(async (tx) => {
        const priorCorrections: Array<DuplicateRetractionResult | null> = commands.map(
          () => null,
        )
        if (sourceReceipt && !(await reserveSourceReceipt(tx, sourceReceipt))) {
          let found = false
          for (const [index, command] of commands.entries()) {
            const duplicate = await existingRetractionResult(tx, command)
            priorCorrections[index] = duplicate
            found ||= duplicate !== null
          }
          if (!found) {
            throw new Error('Metric source receipt exists without its source correction')
          }
        }

        const results: RetractMetricResult[] = []
        for (const [index, command] of commands.entries()) {
          const result = await retractMetricEntry(
            tx,
            command,
            idGen,
            priorCorrections[index] ?? undefined,
          )
          if (sourceReceipt && result.status === 'source_reading_not_found') {
            throw new Error('Metric source reading is not available for retraction')
          }
          results.push(result)
        }
        return results
      })
      return committed
    })

  return {
    recordMetrics,
    recordMetric: async (command: RecordMetricCommand): Promise<ReadingResult> => {
      const { sourceReceipt, ...reading } = command
      const [result] = await recordMetrics({
        readings: [reading],
        sourceReceipt,
      })
      if (!result) throw new Error('Metric command produced no result')
      return result
    },
    retractMetrics,
    retractMetric: async (command: RetractMetricCommand) => {
      const { sourceReceipt, ...entry } = command
      const [result] = await retractMetrics([entry], sourceReceipt)
      if (!result) throw new Error('Metric retraction produced no result')
      return result
    },
  }
}
