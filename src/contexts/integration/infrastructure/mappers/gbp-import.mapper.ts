// Integration context — row ↔ domain mapper for GBP import jobs
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { gbpImportJobs } from '#/shared/db/schema/gbp-import-job.schema'
import type { GbpImportJob } from '../../domain/types'

type GbpImportJobRow = typeof gbpImportJobs.$inferSelect
type GbpImportJobInsertRow = typeof gbpImportJobs.$inferInsert

export const gbpImportJobFromRow = (row: GbpImportJobRow): GbpImportJob => ({
  id: row.id,
  organizationId: row.organizationId,
  initiatedBy: row.initiatedBy,
  status: row.status,
  totalCount: row.totalCount,
  importedCount: row.importedCount,
  skippedCount: row.skippedCount,
  failedCount: row.failedCount,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const gbpImportJobToInsert = (job: GbpImportJob): GbpImportJobInsertRow => ({
  id: job.id,
  organizationId: job.organizationId,
  initiatedBy: job.initiatedBy,
  status: job.status,
  totalCount: job.totalCount,
  importedCount: job.importedCount,
  skippedCount: job.skippedCount,
  failedCount: job.failedCount,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
})
