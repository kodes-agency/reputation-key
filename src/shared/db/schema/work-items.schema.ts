import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export type WorkState =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'quarantined'
  | 'uncertain'
  | 'cancelled'
  | 'discarded'
export type WorkRecovery = 'retry' | 'read_back'
export type WorkError =
  'lease_expired' | 'attempts_exhausted' | 'handler_failed' | 'uncertain_write'

// Platform-owned, IDs only. Keep unfinished work and idempotency receipts until
// its owner explicitly settles it; queue retention never deletes this authority.
export const workItems = pgTable(
  'work_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    subjectId: text('subject_id').notNull(),
    kind: text('kind').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    recovery: text('recovery').$type<WorkRecovery>().notNull(),
    state: text('state').$type<WorkState>().notNull().default('pending'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    dispatchAfter: timestamp('dispatch_after', { withTimezone: true }).notNull(),
    dispatchSequence: integer('dispatch_sequence').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(8),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    errorCode: text('error_code').$type<WorkError>(),
    operatorId: text('operator_id'),
    operatorReason: text('operator_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    unique('work_items_idempotency_unique').on(
      table.organizationId,
      table.kind,
      table.idempotencyKey,
    ),
    index('work_items_due_idx')
      .on(table.dispatchAfter, table.organizationId, table.id)
      .where(sql`${table.state} = 'pending'`),
    index('work_items_lease_idx')
      .on(table.leaseExpiresAt, table.id)
      .where(sql`${table.state} = 'running'`),
    index('work_items_org_created_idx').on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
    check(
      'work_items_state_check',
      sql`${table.state} IN ('pending', 'running', 'succeeded', 'quarantined', 'uncertain', 'cancelled', 'discarded')`,
    ),
    check('work_items_recovery_check', sql`${table.recovery} IN ('retry', 'read_back')`),
    check(
      'work_items_attempts_check',
      sql`${table.attempts} >= 0 AND ${table.maxAttempts} BETWEEN 1 AND 100 AND ${table.attempts} <= ${table.maxAttempts} AND ${table.dispatchSequence} >= 0`,
    ),
    check(
      'work_items_lease_check',
      sql`(${table.state} = 'running' AND ${table.leaseToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL) OR (${table.state} <> 'running' AND ${table.leaseToken} IS NULL AND ${table.leaseExpiresAt} IS NULL)`,
    ),
    check(
      'work_items_completion_check',
      sql`(${table.state} IN ('succeeded', 'cancelled', 'discarded')) = (${table.completedAt} IS NOT NULL)`,
    ),
    check(
      'work_items_error_check',
      sql`${table.errorCode} IS NULL OR ${table.errorCode} IN ('lease_expired', 'attempts_exhausted', 'handler_failed', 'uncertain_write')`,
    ),
    check(
      'work_items_identity_check',
      sql`length(${table.kind}) BETWEEN 1 AND 160 AND length(${table.idempotencyKey}) BETWEEN 1 AND 255 AND length(${table.subjectId}) BETWEEN 1 AND 255 AND length(${table.organizationId}) > 0`,
    ),
  ],
)

export type WorkItem = typeof workItems.$inferSelect
