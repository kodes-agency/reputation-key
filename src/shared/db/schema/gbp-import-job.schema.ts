// Integration context — Drizzle schema for gbp_import_jobs table

import { createdAtColumn, updatedAtColumn } from '../columns'
import { pgTable, uuid, varchar, integer, pgEnum, index } from 'drizzle-orm/pg-core'

export const importJobStatusEnum = pgEnum('import_job_status', [
  'queued',
  'in_progress',
  'completed',
  'failed',
  'completed_with_skips',
  'completed_with_failures',
])

export const gbpImportJobs = pgTable(
  'gbp_import_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    initiatedBy: varchar('initiated_by', { length: 255 }).notNull(),
    status: importJobStatusEnum('status').notNull().default('queued'),
    totalCount: integer('total_count').notNull().default(0),
    importedCount: integer('imported_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => ({
    // F171: Index for org-scoped import job queries
    orgIdx: index('gbp_import_jobs_org_idx').on(t.organizationId),
  }),
)
