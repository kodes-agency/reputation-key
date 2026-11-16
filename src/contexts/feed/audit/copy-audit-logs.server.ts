import { and, asc, eq, gt, gte, inArray, notExists } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { auditLogs } from '#/shared/db/schema/audit'
import {
  auditEvents,
  AUDIT_EVENT_RETENTION_DAYS,
} from '#/shared/db/schema/audit-events.schema'
import { parseAuditEvent, type AuditEvent } from './event.server'

export const DEFAULT_AUDIT_COPY_BATCH_SIZE = 500
export const MAX_AUDIT_COPY_BATCH_SIZE = 5000

const DAY_MS = 24 * 60 * 60 * 1000
const COPIED_SOURCE_KINDS = ['operator_command', 'interactive_command'] as const

export type AuditLogRecord = typeof auditLogs.$inferSelect

export type AuditLogCopyCounts = Readonly<{
  /** Rows inside the retention window with no audit event twin. */
  toCopy: number
  /** Of those, rows whose values the audit event shape refuses. */
  unmappable: number
}>

export type AuditLogCopyResult = Readonly<{ copied: number }>

const boundedBatchSize = (value: number | undefined): number => {
  const size = value ?? DEFAULT_AUDIT_COPY_BATCH_SIZE
  if (!Number.isInteger(size) || size < 1 || size > MAX_AUDIT_COPY_BATCH_SIZE) {
    throw new Error(
      `batch size must be an integer from 1 to ${MAX_AUDIT_COPY_BATCH_SIZE}`,
    )
  }
  return size
}

const propertyIdOf = (details: unknown): string | null => {
  if (typeof details !== 'object' || details === null) return null
  const value = (details as { propertyId?: unknown }).propertyId
  return typeof value === 'string' ? value : null
}

/**
 * One `audit_logs` row as an audit event. The row's id is the event's source
 * identity; details beyond the Property, the address and the update time are
 * not carried. Throws when the shape refuses a value.
 */
export function auditEventFromLog(row: AuditLogRecord): AuditEvent {
  const operator = row.action.startsWith('platform.')
  const isOperatorActor = operator || row.userId.startsWith('ops:')
  const isSystem = row.userId === 'system'
  return parseAuditEvent({
    organizationId: row.organizationId,
    propertyId: propertyIdOf(row.details),
    actorType: isSystem ? 'system' : isOperatorActor ? 'operator' : 'user',
    actorId: isSystem ? null : row.userId,
    action: row.action,
    outcome: row.success ? 'succeeded' : 'failed',
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    sourceKind: operator ? 'operator_command' : 'interactive_command',
    sourceId: row.id,
    sourceEventType: null,
    sourceEventVersion: null,
    sourceContext: null,
    sourceAggregateId: null,
    occurredAt: row.createdAt,
  })
}

const isMappable = (row: AuditLogRecord): boolean => {
  try {
    auditEventFromLog(row)
    return true
  } catch {
    return false
  }
}

const windowStart = (now: Date) =>
  new Date(now.getTime() - AUDIT_EVENT_RETENTION_DAYS * DAY_MS)

const uncopied = (db: Database, now: Date) =>
  and(
    gte(auditLogs.createdAt, windowStart(now)),
    notExists(
      db
        .select({ one: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organizationId, auditLogs.organizationId),
            eq(auditEvents.sourceId, auditLogs.id),
            inArray(auditEvents.sourceKind, [...COPIED_SOURCE_KINDS]),
          ),
        ),
    ),
  )

/** Uncopied rows in id order, a batch at a time, after the given id. */
async function readBatch(
  db: Database,
  now: Date,
  afterId: string | null,
  batchSize: number,
): Promise<AuditLogRecord[]> {
  return db
    .select()
    .from(auditLogs)
    .where(
      and(uncopied(db, now), afterId === null ? undefined : gt(auditLogs.id, afterId)),
    )
    .orderBy(asc(auditLogs.id))
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

/** Counts only: how many rows a copy would write, and how many it would refuse. */
export async function countAuditLogsToCopy(
  db: Database,
  now: Date = new Date(),
): Promise<AuditLogCopyCounts> {
  let toCopy = 0
  let unmappable = 0
  for await (const rows of uncopiedBatches(db, now, DEFAULT_AUDIT_COPY_BATCH_SIZE)) {
    toCopy += rows.length
    unmappable += rows.filter((row) => !isMappable(row)).length
  }
  return { toCopy, unmappable }
}

/**
 * Copies `audit_logs` rows from the retention window that have no audit event
 * twin. Refuses before writing anything when a row cannot be mapped, so a
 * rerun after the data is fixed starts clean. A second run copies nothing.
 */
export async function copyAuditLogs(
  db: Database,
  options: Readonly<{ batchSize?: number; now?: Date }> = {},
): Promise<AuditLogCopyResult> {
  const batchSize = boundedBatchSize(options.batchSize)
  const now = options.now ?? new Date()
  const { unmappable } = await countAuditLogsToCopy(db, now)
  if (unmappable > 0) {
    throw new Error(
      `${unmappable} legacy audit rows cannot be copied; nothing was written`,
    )
  }
  let copied = 0
  for await (const rows of uncopiedBatches(db, now, batchSize)) {
    const inserted = await db
      .insert(auditEvents)
      .values(rows.map((row) => ({ ...auditEventFromLog(row), id: crypto.randomUUID() })))
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
