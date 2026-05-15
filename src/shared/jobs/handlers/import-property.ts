// BullMQ job handler for importing GBP locations as properties.
// Processes a batch of GBP locations, creates properties, tracks counts.

import type { Job } from 'bullmq'
import type { JobHandler } from '../registry'
// eslint-disable-next-line boundaries/dependencies -- Job handlers implement the port contract
import type { ImportPropertyJobData } from '#/contexts/integration/application/ports/gbp-queue.port'
import { createHash } from 'crypto'
import { getDb } from '#/shared/db'
import { properties, gbpImportJobs } from '#/shared/db/schema'
import { getLogger } from '#/shared/observability/logger'
// eslint-disable-next-line no-restricted-imports -- Job handlers need drizzle operators for database queries
import { and, eq, inArray, sql } from 'drizzle-orm'
// eslint-disable-next-line boundaries/dependencies -- Job handlers need domain rules for normalization
import { normalizeSlug } from '#/contexts/property/domain/rules'

export const importPropertyHandler: JobHandler<ImportPropertyJobData> = async (
  job: Job<ImportPropertyJobData>,
) => {
  const { jobId, organizationId, connectionId, locations } = job.data
  const db = getDb()

  await db
    .update(gbpImportJobs)
    .set({ status: 'in_progress', updatedAt: new Date() })
    .where(
      and(eq(gbpImportJobs.organizationId, organizationId), eq(gbpImportJobs.id, jobId)),
    )

  try {
    // Batch fetch existing properties for all gbpPlaceIds (fixes N+1 query)
    const gbpPlaceIds = locations.map((loc) => loc.gbpPlaceId)
    const existingProperties = await db
      .select({ gbpPlaceId: properties.gbpPlaceId })
      .from(properties)
      .where(
        and(
          eq(properties.organizationId, organizationId),
          inArray(properties.gbpPlaceId, gbpPlaceIds),
        ),
      )

    const existingGbpPlaceIds = new Set(existingProperties.map((p) => p.gbpPlaceId))

    for (const location of locations) {
      try {
        // Skip if already exists (using pre-fetched set)
        if (existingGbpPlaceIds.has(location.gbpPlaceId)) {
          await db
            .update(gbpImportJobs)
            .set({
              skippedCount: sql`${gbpImportJobs.skippedCount} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(gbpImportJobs.organizationId, organizationId),
                eq(gbpImportJobs.id, jobId),
              ),
            )
          continue
        }

        // Generate unique slug from business name + truncated SHA-256 of gbpPlaceId
        const baseSlug = normalizeSlug(location.businessName)
        const slugSuffix = createHash('sha256')
          .update(location.gbpPlaceId)
          .digest('base64url')
          .slice(0, 8)
        const slug = `${baseSlug}-${slugSuffix}`

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
          .where(
            and(
              eq(gbpImportJobs.organizationId, organizationId),
              eq(gbpImportJobs.id, jobId),
            ),
          )
      } catch (err) {
        const isPg23505 =
          err instanceof Error &&
          'code' in err &&
          (err as { code: string }).code === '23505'

        // 23505 fires for any unique constraint. Only treat as skip if the
        // gbpPlaceId already exists (concurrent worker race). Slug collisions
        // from different locations are real failures.
        let treatAsSkip = false
        if (isPg23505) {
          const race = await db
            .select({ id: properties.id })
            .from(properties)
            .where(
              and(
                eq(properties.organizationId, organizationId),
                eq(properties.gbpPlaceId, location.gbpPlaceId),
              ),
            )
            .limit(1)
          treatAsSkip = race.length > 0
        }

        if (!treatAsSkip) {
          const logger = getLogger()
          logger.error(
            {
              jobId,
              organizationId,
              gbpPlaceId: location.gbpPlaceId,
              businessName: location.businessName,
              err,
            },
            'GBP property import failed',
          )
        }

        await db
          .update(gbpImportJobs)
          .set(
            treatAsSkip
              ? {
                  skippedCount: sql`${gbpImportJobs.skippedCount} + 1`,
                  updatedAt: new Date(),
                }
              : {
                  failedCount: sql`${gbpImportJobs.failedCount} + 1`,
                  updatedAt: new Date(),
                },
          )
          .where(
            and(
              eq(gbpImportJobs.organizationId, organizationId),
              eq(gbpImportJobs.id, jobId),
            ),
          )
      }
    }

    // Read final counts to determine terminal status
    const [jobRow] = await db
      .select({
        failedCount: gbpImportJobs.failedCount,
        importedCount: gbpImportJobs.importedCount,
        skippedCount: gbpImportJobs.skippedCount,
        totalCount: gbpImportJobs.totalCount,
      })
      .from(gbpImportJobs)
      .where(
        and(
          eq(gbpImportJobs.organizationId, organizationId),
          eq(gbpImportJobs.id, jobId),
        ),
      )

    // Fixed status logic: distinguish failures from skips
    const finalStatus = !jobRow
      ? 'failed'
      : jobRow.totalCount === 0
        ? 'failed'
        : jobRow.failedCount >= jobRow.totalCount
          ? 'failed'
          : jobRow.failedCount > 0
            ? 'completed_with_failures'
            : jobRow.skippedCount > 0
              ? 'completed_with_skips'
              : 'completed'

    await db
      .update(gbpImportJobs)
      .set({ status: finalStatus, updatedAt: new Date() })
      .where(
        and(
          eq(gbpImportJobs.organizationId, organizationId),
          eq(gbpImportJobs.id, jobId),
        ),
      )
  } catch (err) {
    // Unexpected crash — log and mark job as failed if still in_progress
    const logger = getLogger()
    logger.error({ err, jobId, organizationId }, 'Import handler crashed unexpectedly')

    await db
      .update(gbpImportJobs)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(
        and(
          eq(gbpImportJobs.organizationId, organizationId),
          eq(gbpImportJobs.id, jobId),
          eq(gbpImportJobs.status, 'in_progress'),
        ),
      )
  }
}
