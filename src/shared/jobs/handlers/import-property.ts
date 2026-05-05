// BullMQ job handler for importing GBP locations as properties.
// Processes a batch of GBP locations, creates properties, tracks counts.

import type { Job } from 'bullmq'
import type { JobHandler } from '../registry'
import { getDb } from '#/shared/db'
import { properties, gbpImportJobs } from '#/shared/db/schema'
// eslint-disable-next-line no-restricted-imports -- Job handlers need drizzle operators for database queries
import { eq, sql } from 'drizzle-orm'
// eslint-disable-next-line boundaries/dependencies -- Job handlers need domain rules for normalization
import { normalizeSlug } from '#/contexts/property/domain/rules'

export type ImportPropertyJobData = Readonly<{
  jobId: string
  organizationId: string
  connectionId: string
  locations: ReadonlyArray<{
    gbpPlaceId: string
    businessName: string
    address: string | null
    primaryCategory: string | null
    latitude: number | null
    longitude: number | null
  }>
}>

export const importPropertyHandler: JobHandler<ImportPropertyJobData> = async (
  job: Job<ImportPropertyJobData>,
) => {
  const { jobId, organizationId, connectionId, locations } = job.data
  const db = getDb()

  await db
    .update(gbpImportJobs)
    .set({ status: 'in_progress', updatedAt: new Date() })
    .where(eq(gbpImportJobs.id, jobId))

  for (const location of locations) {
    try {
      // Check duplicate by gbpPlaceId in this org
      const existing = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.gbpPlaceId, location.gbpPlaceId))
        .limit(1)

      if (existing.length > 0) {
        await db
          .update(gbpImportJobs)
          .set({
            skippedCount: sql`${gbpImportJobs.skippedCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(gbpImportJobs.id, jobId))
        continue
      }

      // Generate slug from business name
      const slug = normalizeSlug(location.businessName)

      await db.insert(properties).values({
        organizationId,
        name: location.businessName,
        slug,
        timezone: 'UTC',
        gbpPlaceId: location.gbpPlaceId,
        googleConnectionId: connectionId,
      })

      await db
        .update(gbpImportJobs)
        .set({
          importedCount: sql`${gbpImportJobs.importedCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(gbpImportJobs.id, jobId))
    } catch {
      await db
        .update(gbpImportJobs)
        .set({
          failedCount: sql`${gbpImportJobs.failedCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(gbpImportJobs.id, jobId))
    }
  }

  await db
    .update(gbpImportJobs)
    .set({ status: 'completed', updatedAt: new Date() })
    .where(eq(gbpImportJobs.id, jobId))
}
