// Integration context — Drizzle repository implementation for GBP import jobs
// Per architecture: factory function returning Readonly<{ method }>.
// Uses sql template literal for incrementing counters.

import { eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { gbpImportJobs } from '#/shared/db/schema/gbp-import-job.schema'
import type { GbpImportRepository } from '../../application/ports/gbp-import.repository'
import { gbpImportJobFromRow, gbpImportJobToInsert } from '../mappers/gbp-import.mapper'
import { trace } from '#/shared/observability/trace'

export const createGbpImportRepository = (db: Database): GbpImportRepository => ({
  findById: async (id) => {
    return trace('gbpImport.findById', async () => {
      const rows = await db
        .select()
        .from(gbpImportJobs)
        .where(eq(gbpImportJobs.id, id))
        .limit(1)
      return rows[0] ? gbpImportJobFromRow(rows[0]) : null
    })
  },

  findByOrganization: async (orgId) => {
    return trace('gbpImport.findByOrganization', async () => {
      const rows = await db
        .select()
        .from(gbpImportJobs)
        .where(eq(gbpImportJobs.organizationId, orgId))
        .orderBy(gbpImportJobs.createdAt)
      return rows.map(gbpImportJobFromRow)
    })
  },

  insert: async (job) => {
    return trace('gbpImport.insert', async () => {
      await db.insert(gbpImportJobs).values(gbpImportJobToInsert(job))
    })
  },

  updateStatus: async (id, status) => {
    return trace('gbpImport.updateStatus', async () => {
      await db
        .update(gbpImportJobs)
        .set({
          status,
          updatedAt: new Date(),
        })
        .where(eq(gbpImportJobs.id, id))
    })
  },

  incrementImported: async (id) => {
    return trace('gbpImport.incrementImported', async () => {
      await db
        .update(gbpImportJobs)
        .set({
          importedCount: sql`${gbpImportJobs.importedCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(gbpImportJobs.id, id))
    })
  },

  incrementSkipped: async (id) => {
    return trace('gbpImport.incrementSkipped', async () => {
      await db
        .update(gbpImportJobs)
        .set({
          skippedCount: sql`${gbpImportJobs.skippedCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(gbpImportJobs.id, id))
    })
  },

  incrementFailed: async (id) => {
    return trace('gbpImport.incrementFailed', async () => {
      await db
        .update(gbpImportJobs)
        .set({
          failedCount: sql`${gbpImportJobs.failedCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(gbpImportJobs.id, id))
    })
  },
})
