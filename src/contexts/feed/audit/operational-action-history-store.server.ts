import { and, desc, eq, lt, lte, or, sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  operationalActionHistoryHeads,
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
} from './operational-action-history-store.port.server'

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

const isAccessRecord = (
  record: OperationalActionRecord,
  tenantId: OperationalActionRecord['organizationId'],
): boolean =>
  record.organizationId === tenantId &&
  (record.action === 'operational_history.accessed' ||
    record.action === 'operational_history.exported') &&
  record.resourceType === 'operational_history' &&
  record.provenance.kind === 'history_access'

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
    transact(database, async (transaction) => {
      if (!isAccessRecord(accessRecord, query.organizationId)) {
        throw new Error('Operational Action History access record is invalid')
      }
      // Serialize restricted reads with appends: the head lock is that
      // serialization, and the page is read after it is held. The read runs at
      // the default isolation level because a repeatable-read snapshot would
      // be taken before the lock, and an append committing while the read
      // waited for it would end the read with SQLSTATE 40001.
      await lockSequenceHead(transaction, query.organizationId)
      const page = await queryPage(transaction, query)
      await appendInTransaction(transaction, accessRecord)
      return page
    }),
})
