import { and, desc, eq, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  operationalActionHistoryHeads,
  operationalActionHistoryLegalHolds,
  operationalActionHistoryRecords,
  type OperationalActionHistoryRecordRow,
} from '#/shared/db/schema/activity.schema'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  operationalActionHistoryRecordId,
  type OperationalAction,
  type OperationalActionActorType,
  type OperationalActionOutcome,
  type OperationalActionProvenanceKind,
  type OperationalActionRecord,
  type OperationalActionResourceType,
} from '../domain/operational-action-history'
import type {
  OperationalActionHistoryEntry,
  OperationalActionHistoryDeliveryStore,
  OperationalActionHistoryPage,
  OperationalActionHistoryStore,
} from '../ports/operational-action-history-store.port'

export type ActivityTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
export type OperationalActionHistoryDatabase = Database | ActivityTransaction

const isTopLevelDatabase = (
  database: OperationalActionHistoryDatabase,
): database is Database => '$client' in database

const transact = <T>(
  database: OperationalActionHistoryDatabase,
  operation: (transaction: ActivityTransaction) => Promise<T>,
  coherentSnapshot = false,
): Promise<T> =>
  isTopLevelDatabase(database)
    ? database.transaction(
        operation,
        coherentSnapshot ? { isolationLevel: 'repeatable read' } : undefined,
      )
    : database.transaction(operation)

const safeInteger = (value: unknown, label: string): number => {
  const parsed = typeof value === 'number' ? value : Number(String(value))
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Operational Action History ${label} is invalid`)
  }
  return parsed
}

const dateOrNull = (value: unknown, label: string): Date | null => {
  if (value === null || value === undefined) return null
  const parsed = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Operational Action History ${label} is invalid`)
  }
  return parsed
}

const entryFromRow = (
  row: OperationalActionHistoryRecordRow,
): OperationalActionHistoryEntry => ({
  id: operationalActionHistoryRecordId(row.id),
  organizationId: organizationId(row.organizationId),
  propertyId: row.propertyId === null ? null : propertyId(row.propertyId),
  actorType: row.actorType as OperationalActionActorType,
  actorId: row.actorId,
  actorRedactedAt: row.actorRedactedAt,
  action: row.action as OperationalAction,
  outcome: row.outcome as OperationalActionOutcome,
  resourceType: row.resourceType as OperationalActionResourceType,
  resourceId: row.resourceId,
  resourceRedactedAt: row.resourceRedactedAt,
  reasonCode: row.reasonCode,
  provenance: {
    kind: row.provenanceKind as OperationalActionProvenanceKind,
    id: row.provenanceId,
    eventType: row.sourceEventType,
    eventVersion: row.sourceEventVersion,
    sourceContext: row.sourceContext,
    sourceAggregateId: row.sourceAggregateId,
  },
  occurredAt: row.occurredAt,
  recordedAt: row.recordedAt,
  sequence: safeInteger(row.sequence, 'record sequence'),
})

const valuesForRecord = (record: OperationalActionRecord, sequence: number) => ({
  id: record.id as string,
  organizationId: record.organizationId as string,
  sequence,
  propertyId: record.propertyId as string | null,
  actorType: record.actorType,
  actorId: record.actorId,
  actorRedactedAt: null,
  action: record.action,
  outcome: record.outcome,
  resourceType: record.resourceType,
  resourceId: record.resourceId,
  resourceRedactedAt: null,
  reasonCode: record.reasonCode,
  provenanceKind: record.provenance.kind,
  provenanceId: record.provenance.id,
  sourceEventType: record.provenance.eventType,
  sourceEventVersion: record.provenance.eventVersion,
  sourceContext: record.provenance.sourceContext,
  sourceAggregateId: record.provenance.sourceAggregateId,
  occurredAt: record.occurredAt,
  recordedAt: record.recordedAt,
})

const sameRetry = (
  stored: OperationalActionHistoryEntry,
  incoming: OperationalActionRecord,
): boolean =>
  stored.organizationId === incoming.organizationId &&
  stored.propertyId === incoming.propertyId &&
  stored.actorType === incoming.actorType &&
  (stored.actorRedactedAt !== null || stored.actorId === incoming.actorId) &&
  stored.action === incoming.action &&
  stored.outcome === incoming.outcome &&
  stored.resourceType === incoming.resourceType &&
  (stored.resourceRedactedAt !== null || stored.resourceId === incoming.resourceId) &&
  stored.reasonCode === incoming.reasonCode &&
  stored.provenance.kind === incoming.provenance.kind &&
  stored.provenance.id === incoming.provenance.id &&
  stored.provenance.eventType === incoming.provenance.eventType &&
  stored.provenance.eventVersion === incoming.provenance.eventVersion &&
  stored.provenance.sourceContext === incoming.provenance.sourceContext &&
  stored.provenance.sourceAggregateId === incoming.provenance.sourceAggregateId &&
  (incoming.provenance.kind !== 'domain_fact' ||
    stored.occurredAt.getTime() === incoming.occurredAt.getTime())

const findByProvenance = async (
  transaction: ActivityTransaction,
  record: OperationalActionRecord,
): Promise<OperationalActionHistoryEntry | null> => {
  const rows = await transaction
    .select()
    .from(operationalActionHistoryRecords)
    .where(
      and(
        eq(
          operationalActionHistoryRecords.organizationId,
          record.organizationId as string,
        ),
        eq(operationalActionHistoryRecords.provenanceKind, record.provenance.kind),
        eq(operationalActionHistoryRecords.provenanceId, record.provenance.id),
      ),
    )
    .limit(1)
  return rows[0] ? entryFromRow(rows[0]) : null
}

const lockSequenceHead = async (
  transaction: ActivityTransaction,
  tenantId: OperationalActionRecord['organizationId'],
): Promise<Readonly<{ lastSequence: number; lastRecordedAt: Date | null }>> => {
  await transaction
    .insert(operationalActionHistoryHeads)
    .values({ organizationId: tenantId as string })
    .onConflictDoNothing({ target: operationalActionHistoryHeads.organizationId })

  const result = await transaction.execute<{
    last_sequence: number | string
    last_recorded_at: Date | string | null
  }>(sql`
    SELECT last_sequence, last_recorded_at
    FROM operational_action_history_heads
    WHERE organization_id = ${tenantId as string}
    FOR UPDATE
  `)
  const head = result.rows[0]
  if (!head) throw new Error('Operational Action History sequence head is unavailable')
  return {
    lastSequence: safeInteger(head.last_sequence, 'sequence head'),
    lastRecordedAt: dateOrNull(head.last_recorded_at, 'sequence-head time'),
  }
}

const appendInTransaction = async (
  transaction: ActivityTransaction,
  record: OperationalActionRecord,
): Promise<Readonly<{ status: 'appended' | 'duplicate'; sequence: number }>> => {
  const head = await lockSequenceHead(transaction, record.organizationId)

  const existing = await findByProvenance(transaction, record)
  if (existing) {
    if (!sameRetry(existing, record)) {
      throw new Error('Operational Action History provenance conflicts with retry')
    }
    return { status: 'duplicate', sequence: existing.sequence }
  }

  const nextSequence = head.lastSequence + 1
  const inserted = await transaction
    .insert(operationalActionHistoryRecords)
    .values(valuesForRecord(record, nextSequence))
    .returning()
  if (!inserted[0]) throw new Error('Operational Action History append did not apply')

  const monotonicRecordedAt =
    head.lastRecordedAt && head.lastRecordedAt.getTime() > record.recordedAt.getTime()
      ? head.lastRecordedAt
      : record.recordedAt
  await transaction
    .update(operationalActionHistoryHeads)
    .set({
      lastSequence: nextSequence,
      lastRecordedAt: monotonicRecordedAt,
      updatedAt: monotonicRecordedAt,
    })
    .where(
      eq(operationalActionHistoryHeads.organizationId, record.organizationId as string),
    )
  return { status: 'appended', sequence: nextSequence }
}

const queryPage = async (
  transaction: ActivityTransaction,
  query: Parameters<OperationalActionHistoryStore['readWithAccess']>[0]['query'],
): Promise<OperationalActionHistoryPage> => {
  const conditions: SQL[] = [
    eq(operationalActionHistoryRecords.organizationId, query.organizationId as string),
    lte(operationalActionHistoryRecords.recordedAt, query.observedAt),
  ]
  if (query.propertyId) {
    conditions.push(
      eq(operationalActionHistoryRecords.propertyId, query.propertyId as string),
    )
  }
  if (query.action) {
    conditions.push(eq(operationalActionHistoryRecords.action, query.action))
  }
  if (query.resourceType) {
    conditions.push(eq(operationalActionHistoryRecords.resourceType, query.resourceType))
  }
  if (query.cursor) {
    conditions.push(
      or(
        lt(operationalActionHistoryRecords.occurredAt, query.cursor.occurredAt),
        and(
          eq(operationalActionHistoryRecords.occurredAt, query.cursor.occurredAt),
          lt(operationalActionHistoryRecords.sequence, query.cursor.sequence),
        ),
      ) as SQL,
    )
  }

  const rows = await transaction
    .select()
    .from(operationalActionHistoryRecords)
    .where(and(...conditions))
    .orderBy(
      desc(operationalActionHistoryRecords.occurredAt),
      desc(operationalActionHistoryRecords.sequence),
    )
    .limit(query.limit + 1)
  const hasMore = rows.length > query.limit
  const items = rows.slice(0, query.limit).map(entryFromRow)
  const boundary = hasMore ? items.at(-1) : undefined
  return {
    items,
    nextCursor: boundary
      ? { occurredAt: boundary.occurredAt, sequence: boundary.sequence }
      : null,
  }
}

const activeHoldPredicate = sql`
  hold.organization_id = record.organization_id
  AND hold.released_at IS NULL
  AND record.occurred_at >= hold.protects_from
  AND (hold.protects_through IS NULL OR record.occurred_at <= hold.protects_through)
`

const isAccessRecord = (
  record: OperationalActionRecord,
  tenantId: OperationalActionRecord['organizationId'],
): boolean =>
  record.organizationId === tenantId &&
  (record.action === 'operational_history.accessed' ||
    record.action === 'operational_history.exported') &&
  record.resourceType === 'operational_history' &&
  record.provenance.kind === 'history_access'

const isLifecycleRecord = (
  record: OperationalActionRecord,
  input: Readonly<{
    organizationId: OperationalActionRecord['organizationId']
    action: OperationalAction
    reasonCode: string
  }>,
): boolean =>
  record.organizationId === input.organizationId &&
  record.action === input.action &&
  record.resourceType === 'operational_history' &&
  record.actorType === 'operator' &&
  record.provenance.kind === 'history_lifecycle' &&
  record.reasonCode === input.reasonCode

export const createOperationalActionHistoryStore = (
  database: OperationalActionHistoryDatabase,
): OperationalActionHistoryStore & OperationalActionHistoryDeliveryStore => ({
  append: (record) =>
    transact(database, (transaction) => appendInTransaction(transaction, record)),

  applyOnce: ({ record, eventId, consumerName }) =>
    transact(database, async (transaction) => {
      const result = await appendInTransaction(transaction, record)
      const status = result.status === 'appended' ? 'applied' : 'duplicate'
      await transaction
        .insert(eventConsumerReceipts)
        .values({ eventId, consumerName, status })
        .onConflictDoNothing()
      return status
    }),

  readWithAccess: ({ query, accessRecord }) =>
    transact(
      database,
      async (transaction) => {
        if (!isAccessRecord(accessRecord, query.organizationId)) {
          throw new Error('Operational Action History access record is invalid')
        }
        // Serialize restricted reads with identifier redaction and hold lifecycle
        // so a snapshot cannot return attribution after a concurrent redaction
        // has committed ahead of its access receipt.
        await lockSequenceHead(transaction, query.organizationId)
        const page = await queryPage(transaction, query)
        await appendInTransaction(transaction, accessRecord)
        return page
      },
      true,
    ),

  readReadiness: (tenantId) =>
    transact(
      database,
      async (transaction) => {
        const coverageResult = await transaction.execute<{
          last_sequence: number | string | null
          covered_count: number | string
          duplicate_count: number | string
          minimum_sequence: number | string | null
          maximum_sequence: number | string | null
          oldest_record_at: Date | string | null
          newest_record_at: Date | string | null
        }>(sql`
          SELECT coalesce(head.last_sequence, 0)::text AS last_sequence,
                 count(record.id)::text AS covered_count,
                 (count(record.id) - count(DISTINCT record.sequence))::text
                   AS duplicate_count,
                 min(record.sequence)::text AS minimum_sequence,
                 max(record.sequence)::text AS maximum_sequence,
                 min(record.recorded_at) AS oldest_record_at,
                 max(record.recorded_at) AS newest_record_at
          FROM (SELECT ${tenantId as string}::varchar AS organization_id) AS scope
          LEFT JOIN operational_action_history_heads AS head
            ON head.organization_id = scope.organization_id
          LEFT JOIN operational_action_history_records AS record
            ON record.organization_id = scope.organization_id
          GROUP BY head.last_sequence
        `)
        const holdsResult = await transaction.execute<{ active_count: string }>(sql`
          SELECT count(*)::text AS active_count
          FROM operational_action_history_legal_holds
          WHERE organization_id = ${tenantId as string}
            AND released_at IS NULL
        `)
        const coverage = coverageResult.rows[0]
        return {
          lastSequence: coverage
            ? safeInteger(coverage.last_sequence, 'sequence head')
            : 0,
          coveredSequenceCount: coverage
            ? safeInteger(coverage.covered_count, 'coverage count')
            : 0,
          duplicateSequenceCount: coverage
            ? safeInteger(coverage.duplicate_count, 'duplicate count')
            : 0,
          minimumSequence:
            coverage?.minimum_sequence === null ||
            coverage?.minimum_sequence === undefined
              ? null
              : safeInteger(coverage.minimum_sequence, 'minimum sequence'),
          maximumSequence:
            coverage?.maximum_sequence === null ||
            coverage?.maximum_sequence === undefined
              ? null
              : safeInteger(coverage.maximum_sequence, 'maximum sequence'),
          oldestRecordAt: dateOrNull(coverage?.oldest_record_at, 'oldest time'),
          newestRecordAt: dateOrNull(coverage?.newest_record_at, 'newest time'),
          activeLegalHoldCount: safeInteger(
            holdsResult.rows[0]?.active_count ?? 0,
            'active legal-hold count',
          ),
        }
      },
      true,
    ),

  assessRetention: ({ organizationId: tenantId, cutoff, assessmentRecord }) =>
    transact(
      database,
      async (transaction) => {
        if (
          !isLifecycleRecord(assessmentRecord, {
            organizationId: tenantId,
            action: 'operational_history.retention_assessed',
            reasonCode: 'report_only_pending_counsel',
          })
        ) {
          throw new Error(
            'Operational Action History retention-assessment record is invalid',
          )
        }
        await appendInTransaction(transaction, assessmentRecord)
        const result = await transaction.execute<{
          eligible_count: string
          held_count: string
          oldest_eligible_at: Date | string | null
        }>(sql`
          SELECT count(*) FILTER (WHERE NOT EXISTS (
                   SELECT 1
                   FROM operational_action_history_legal_holds AS hold
                   WHERE ${activeHoldPredicate}
                 ))::text AS eligible_count,
                 count(*) FILTER (WHERE EXISTS (
                   SELECT 1
                   FROM operational_action_history_legal_holds AS hold
                   WHERE ${activeHoldPredicate}
                 ))::text AS held_count,
                 min(record.occurred_at) FILTER (WHERE NOT EXISTS (
                   SELECT 1
                   FROM operational_action_history_legal_holds AS hold
                   WHERE ${activeHoldPredicate}
                 )) AS oldest_eligible_at
          FROM operational_action_history_records AS record
          WHERE record.organization_id = ${tenantId as string}
            AND record.occurred_at < ${cutoff}
        `)
        const row = result.rows[0]
        if (!row) throw new Error('Operational Action History retention read failed')
        return {
          eligibleCount: safeInteger(row.eligible_count, 'eligible retention count'),
          heldCount: safeInteger(row.held_count, 'held retention count'),
          oldestEligibleAt: dateOrNull(
            row.oldest_eligible_at,
            'oldest eligible retention time',
          ),
        }
      },
      true,
    ),

  placeLegalHold: ({ hold, actionRecord }) =>
    transact(database, async (transaction) => {
      if (
        !isLifecycleRecord(actionRecord, {
          organizationId: hold.organizationId,
          action: 'operational_history.legal_hold_placed',
          reasonCode: hold.reasonCode,
        }) ||
        actionRecord.resourceId !== hold.id ||
        actionRecord.actorId !== hold.placedByActorId
      ) {
        throw new Error('Operational Action History legal-hold action is invalid')
      }
      await lockSequenceHead(transaction, hold.organizationId)
      const existingAction = await findByProvenance(transaction, actionRecord)
      if (existingAction) {
        if (
          !sameRetry(existingAction, {
            ...actionRecord,
            resourceId: existingAction.resourceId,
          }) ||
          existingAction.resourceId === null
        ) {
          throw new Error('Operational Action History legal-hold retry conflicts')
        }
        const existingHold = await transaction
          .select()
          .from(operationalActionHistoryLegalHolds)
          .where(eq(operationalActionHistoryLegalHolds.id, existingAction.resourceId))
          .limit(1)
        const row = existingHold[0]
        if (
          !row ||
          row.organizationId !== hold.organizationId ||
          row.reasonCode !== hold.reasonCode ||
          row.protectsFrom.getTime() !== hold.protectsFrom.getTime() ||
          row.protectsThrough?.getTime() !== hold.protectsThrough?.getTime() ||
          row.placedByActorId !== hold.placedByActorId
        ) {
          throw new Error('Operational Action History legal-hold retry conflicts')
        }
        return { status: 'duplicate' as const, holdId: row.id }
      }
      const inserted = await transaction
        .insert(operationalActionHistoryLegalHolds)
        .values({
          id: hold.id,
          organizationId: hold.organizationId as string,
          reasonCode: hold.reasonCode,
          protectsFrom: hold.protectsFrom,
          protectsThrough: hold.protectsThrough,
          placedAt: hold.placedAt,
          placedByActorId: hold.placedByActorId,
        })
        .onConflictDoNothing({ target: operationalActionHistoryLegalHolds.id })
        .returning()
      if (!inserted[0]) {
        const existing = await transaction
          .select()
          .from(operationalActionHistoryLegalHolds)
          .where(eq(operationalActionHistoryLegalHolds.id, hold.id))
          .limit(1)
        const row = existing[0]
        if (
          !row ||
          row.organizationId !== hold.organizationId ||
          row.reasonCode !== hold.reasonCode ||
          row.protectsFrom.getTime() !== hold.protectsFrom.getTime() ||
          row.protectsThrough?.getTime() !== hold.protectsThrough?.getTime() ||
          row.placedAt.getTime() !== hold.placedAt.getTime() ||
          row.placedByActorId !== hold.placedByActorId
        ) {
          throw new Error('Operational Action History legal hold conflicts with retry')
        }
        throw new Error('Operational Action History legal-hold id conflicts')
      }
      await appendInTransaction(transaction, actionRecord)
      return { status: 'placed' as const, holdId: hold.id }
    }),

  releaseLegalHold: (input) =>
    transact(database, async (transaction) => {
      if (
        !isLifecycleRecord(input.actionRecord, {
          organizationId: input.organizationId,
          action: 'operational_history.legal_hold_released',
          reasonCode: input.reasonCode,
        }) ||
        input.actionRecord.resourceId !== input.holdId ||
        input.actionRecord.actorId !== input.releasedByActorId
      ) {
        throw new Error('Operational Action History legal-hold release is invalid')
      }
      const locked = await transaction.execute<{
        organization_id: string
        released_at: Date | string | null
        released_by_actor_id: string | null
        release_reason_code: string | null
      }>(sql`
        SELECT organization_id, released_at, released_by_actor_id,
               release_reason_code
        FROM operational_action_history_legal_holds
        WHERE id = ${input.holdId}::uuid
        FOR UPDATE
      `)
      const row = locked.rows[0]
      if (!row || row.organization_id !== input.organizationId) {
        throw new Error('Operational Action History legal hold was not found')
      }
      const existingAction = await findByProvenance(transaction, input.actionRecord)
      if (existingAction) {
        if (
          !sameRetry(existingAction, input.actionRecord) ||
          row.released_at === null ||
          row.released_by_actor_id !== input.releasedByActorId ||
          row.release_reason_code !== input.reasonCode
        ) {
          throw new Error('Operational Action History legal-hold release conflicts')
        }
        return 'duplicate' as const
      }
      if (row.released_at !== null) {
        throw new Error('Operational Action History legal-hold release conflicts')
      }
      await transaction
        .update(operationalActionHistoryLegalHolds)
        .set({
          releasedAt: input.releasedAt,
          releasedByActorId: input.releasedByActorId,
          releaseReasonCode: input.reasonCode,
        })
        .where(eq(operationalActionHistoryLegalHolds.id, input.holdId))
      await appendInTransaction(transaction, input.actionRecord)
      return 'released' as const
    }),

  redactSubject: (input) =>
    transact(database, async (transaction) => {
      if (
        !isLifecycleRecord(input.actionRecord, {
          organizationId: input.organizationId,
          action: 'operational_history.redaction_applied',
          reasonCode: input.reasonCode,
        })
      ) {
        throw new Error('Operational Action History redaction record is invalid')
      }
      await lockSequenceHead(transaction, input.organizationId)
      const existingAction = await findByProvenance(transaction, input.actionRecord)
      if (
        existingAction &&
        !sameRetry(existingAction, {
          ...input.actionRecord,
          outcome: existingAction.outcome,
        })
      ) {
        throw new Error('Operational Action History redaction retry conflicts')
      }
      const subjectColumn =
        input.subjectType === 'actor' ? sql`record.actor_id` : sql`record.resource_id`
      const heldResult = await transaction.execute<{ held_count: string }>(sql`
        SELECT count(*)::text AS held_count
        FROM operational_action_history_records AS record
        WHERE record.organization_id = ${input.organizationId as string}
          AND ${subjectColumn} = ${input.subjectId}
          AND EXISTS (
            SELECT 1
            FROM operational_action_history_legal_holds AS hold
            WHERE ${activeHoldPredicate}
          )
      `)
      const candidates = await transaction.execute<{ id: string }>(sql`
        SELECT record.id
        FROM operational_action_history_records AS record
        WHERE record.organization_id = ${input.organizationId as string}
          AND ${subjectColumn} = ${input.subjectId}
          AND NOT EXISTS (
            SELECT 1
            FROM operational_action_history_legal_holds AS hold
            WHERE ${activeHoldPredicate}
          )
        ORDER BY record.sequence
        LIMIT ${input.limit + 1}
        FOR UPDATE
      `)
      const ids = candidates.rows.slice(0, input.limit).map(({ id }) => id)
      const held = safeInteger(
        heldResult.rows[0]?.held_count ?? 0,
        'held redaction count',
      )
      if (existingAction) {
        return {
          status: 'duplicate' as const,
          redacted: 0,
          held,
          complete: held === 0 && candidates.rows.length === 0,
        }
      }
      if (ids.length > 0) {
        await transaction
          .update(operationalActionHistoryRecords)
          .set(
            input.subjectType === 'actor'
              ? { actorId: null, actorRedactedAt: input.redactedAt }
              : { resourceId: null, resourceRedactedAt: input.redactedAt },
          )
          .where(inArray(operationalActionHistoryRecords.id, ids))
      }
      await appendInTransaction(transaction, {
        ...input.actionRecord,
        outcome: held > 0 && ids.length === 0 ? 'denied' : 'succeeded',
      })
      return {
        status: 'applied' as const,
        redacted: ids.length,
        held,
        complete: held === 0 && candidates.rows.length <= input.limit,
      }
    }),
})
