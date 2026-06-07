// Integration context — row ↔ domain mapper for GBP import jobs
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { gbpImportJobs } from '#/shared/db/schema/gbp-import-job.schema'
import type { GbpImportJob } from '../../domain/types'
import { unbrand } from '#/shared/domain/ids'
import { gbpImportJobId, organizationId, userId } from '#/shared/domain/ids'

type GbpImportJobRow = typeof gbpImportJobs.$inferSelect
type GbpImportJobInsertRow = typeof gbpImportJobs.$inferInsert

export const gbpImportJobFromRow = (row: GbpImportJobRow): GbpImportJob => ({
  id: gbpImportJobId(row.id),
  organizationId: organizationId(row.organizationId),
  initiatedBy: userId(row.initiatedBy),
  status: row.status,
  totalCount: row.totalCount,
  importedCount: row.importedCount,
  skippedCount: row.skippedCount,
  failedCount: row.failedCount,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const gbpImportJobToInsert = (job: GbpImportJob): GbpImportJobInsertRow => ({
  id: unbrand(job.id),
  organizationId: unbrand(job.organizationId),
  initiatedBy: unbrand(job.initiatedBy),
  status: job.status,
  totalCount: job.totalCount,
  importedCount: job.importedCount,
  skippedCount: job.skippedCount,
  failedCount: job.failedCount,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
})
