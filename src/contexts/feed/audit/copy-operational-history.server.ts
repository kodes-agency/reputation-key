import { and, asc, eq, gt, gte, notExists } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  operationalActionHistoryRecords as records,
  type OperationalActionHistoryRecordRow,
} from '#/shared/db/schema/activity.schema'
import {
  auditEvents,
  AUDIT_EVENT_RETENTION_DAYS,
} from '#/shared/db/schema/audit-events.schema'
import { parseAuditEvent, type AuditEvent } from './event.server'

export const DEFAULT_HISTORY_COPY_BATCH_SIZE = 500
export const MAX_HISTORY_COPY_BATCH_SIZE = 5000

const DAY_MS = 24 * 60 * 60 * 1000

export type OperationalHistoryCopyCounts = Readonly<{
  /** Records inside the retention window with no audit event twin. */
  toCopy: number
  /** Of those, records whose values the audit event shape refuses. */
  unmappable: number
}>

export type OperationalHistoryCopyResult = Readonly<{ copied: number }>

const boundedBatchSize = (value: number | undefined): number => {
  const size = value ?? DEFAULT_HISTORY_COPY_BATCH_SIZE
  if (!Number.isInteger(size) || size < 1 || size > MAX_HISTORY_COPY_BATCH_SIZE) {
    throw new Error(
      `batch size must be an integer from 1 to ${MAX_HISTORY_COPY_BATCH_SIZE}`,
    )
  }
  return size
}

/**
 * One earlier history record as an audit event. The record's provenance is the
 * event's source identity; the reason code and recording time are not carried.
 * Throws when the shape refuses a value.
 */
export function auditEventFromHistoryRecord(
  row: OperationalActionHistoryRecordRow,
): AuditEvent {
  return parseAuditEvent({
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    actorType: row.actorType,
    actorId: row.actorId,
    action: row.action,
    outcome: row.outcome,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    sourceKind: row.provenanceKind,
    sourceId: row.provenanceId,
    sourceEventType: row.sourceEventType,
    sourceEventVersion: row.sourceEventVersion,
    sourceContext: row.sourceContext,
    sourceAggregateId: row.sourceAggregateId,
    occurredAt: row.occurredAt,
  })
}

const isMappable = (row: OperationalActionHistoryRecordRow): boolean => {
  try {
    auditEventFromHistoryRecord(row)
    return true
  } catch {
    return false
  }
}

const uncopied = (db: Database, now: Date) =>
  and(
    gte(
      records.occurredAt,
      new Date(now.getTime() - AUDIT_EVENT_RETENTION_DAYS * DAY_MS),
    ),
    notExists(
      db
        .select({ one: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organizationId, records.organizationId),
            eq(auditEvents.sourceKind, records.provenanceKind),
            eq(auditEvents.sourceId, records.provenanceId),
          ),
        ),
    ),
  )

/** Uncopied records in id order, a batch at a time, after the given id. */
async function readBatch(
  db: Database,
  now: Date,
  afterId: string | null,
  batchSize: number,
): Promise<OperationalActionHistoryRecordRow[]> {
  return db
    .select()
    .from(records)
    .where(and(uncopied(db, now), afterId === null ? undefined : gt(records.id, afterId)))
    .orderBy(asc(records.id))
    .limit(batchSize)
}

async function* uncopiedBatches(db: Database, now: Date, batchSize: number) {
  let afterId: string | null = null
  for (;;) {
    const rows = await readBatch(db, now, afterId, batchSize)
    if (rows.length === 0) return
    yield rows
    afterId = rows[rows.length - 1]!.id
  }
}

/** Counts only: how many records a copy would write, and how many it would refuse. */
export async function countOperationalHistoryToCopy(
  db: Database,
  now: Date = new Date(),
): Promise<OperationalHistoryCopyCounts> {
  let toCopy = 0
  let unmappable = 0
  for await (const rows of uncopiedBatches(db, now, DEFAULT_HISTORY_COPY_BATCH_SIZE)) {
    toCopy += rows.length
    unmappable += rows.filter((row) => !isMappable(row)).length
  }
  return { toCopy, unmappable }
}

/**
 * Copies Operational Action History records from the retention window that
 * have no audit event twin. Refuses before writing anything when a record
 * cannot be mapped. A second run copies nothing.
 */
export async function copyOperationalHistory(
  db: Database,
  options: Readonly<{ batchSize?: number; now?: Date }> = {},
): Promise<OperationalHistoryCopyResult> {
  const batchSize = boundedBatchSize(options.batchSize)
  const now = options.now ?? new Date()
  const { unmappable } = await countOperationalHistoryToCopy(db, now)
  if (unmappable > 0) {
    throw new Error(`${unmappable} history records cannot be copied; nothing was written`)
  }
  let copied = 0
  for await (const rows of uncopiedBatches(db, now, batchSize)) {
    const inserted = await db
      .insert(auditEvents)
      .values(
        rows.map((row) => ({
          ...auditEventFromHistoryRecord(row),
          id: crypto.randomUUID(),
        })),
      )
      .onConflictDoNothing({
        target: [
          auditEvents.organizationId,
          auditEvents.sourceKind,
          auditEvents.sourceId,
        ],
      })
      .returning({ id: auditEvents.id })
    copied += inserted.length
  }
  return { copied }
}
