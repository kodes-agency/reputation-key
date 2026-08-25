import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export type RecoveryFenceCounts = Readonly<{
  sessionsInvalidated: number
  verificationTokensInvalidated: number
  invitationsCanceled: number
  outboxEventsFenced: number
  emailsCanceled: number
  digestBatchesTerminated: number
  repliesCanceled: number
  repliesMadeAmbiguous: number
  googleConnectionsFenced: number
  googleExecutionPermitsFenced: number
  googleSourceOperationsFenced: number
  googleRevokePermitsFenced: number
  legacyImportJobsCanceled: number
  legacyImportEffectLeasesReleased: number
  googleImportV2ParentsFenced: number
  googleImportV2ItemsFenced: number
  aiIssuedPermitsReleased: number
  aiConsumedPermitsMadeAmbiguous: number
  aiOperationsFenced: number
  aiBackfillRunsStalled: number
  regionMovesBlocking: number
}>

/**
 * Durable, convergent proof for an isolated-restore recovery fence. Re-running
 * the same source-manifest/restore-point tuple re-scans and fences any authority
 * that appeared after the previous pass, accumulating content-free counts in
 * this row. A distinct restore rotates the monotonic per-cell generation.
 */
export const recoveryRuns = pgTable(
  'recovery_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataCellId: varchar('data_cell_id', { length: 16 }).notNull(),
    generation: integer('generation').notNull(),
    sourceReleaseSha: varchar('source_release_sha', { length: 40 }).notNull(),
    sourceManifestSha256: varchar('source_manifest_sha256', { length: 64 }).notNull(),
    restorePointAt: timestamp('restore_point_at', { withTimezone: true }).notNull(),
    operatorId: varchar('operator_id', { length: 255 }).notNull(),
    correlationId: varchar('correlation_id', { length: 255 }).notNull(),
    counts: jsonb('counts').$type<RecoveryFenceCounts>().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('recovery_runs_cell_generation_unique').on(
      table.dataCellId,
      table.generation,
    ),
    uniqueIndex('recovery_runs_source_unique').on(
      table.dataCellId,
      table.sourceManifestSha256,
      table.restorePointAt,
    ),
    index('recovery_runs_completed_idx').on(table.dataCellId, table.completedAt.desc()),
    check(
      'recovery_runs_cell_valid',
      sql`${table.dataCellId} IN ('us', 'europe', 'global')`,
    ),
    check('recovery_runs_generation_valid', sql`${table.generation} >= 1`),
    check(
      'recovery_runs_source_release_valid',
      sql`${table.sourceReleaseSha} ~ '^[0-9a-f]{40}$'`,
    ),
    check(
      'recovery_runs_source_manifest_valid',
      sql`${table.sourceManifestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'recovery_runs_time_valid',
      sql`${table.restorePointAt} <= ${table.completedAt} AND ${table.completedAt} >= ${table.createdAt}`,
    ),
  ],
)

export type RecoveryRunRow = typeof recoveryRuns.$inferSelect
