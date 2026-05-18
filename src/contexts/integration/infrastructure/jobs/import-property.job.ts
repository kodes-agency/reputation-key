// Integration context — GBP property import job handler.
// Processes a batch of GBP locations, creates properties, tracks counts.
// Moved from shared/jobs/handlers/ — this is business logic that belongs in its context.

import type { Job } from 'bullmq'
import type { JobHandler } from '#/shared/jobs/registry'
import type { ImportPropertyJobData } from '../../application/ports/gbp-queue.port'

export type { ImportPropertyJobData }
import { createHash } from 'crypto'
import { getDb } from '#/shared/db'
import { properties, gbpImportJobs } from '#/shared/db/schema'
import { getLogger } from '#/shared/observability/logger'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { normalizeSlug } from '#/contexts/property/domain/rules'

// ── Counter helpers ────────────────────────────────────────────────

type CounterType = 'importedCount' | 'skippedCount' | 'failedCount'

const incrementJobCounter = async (
  db: ReturnType<typeof getDb>,
  organizationId: string,
  jobId: string,
  counter: CounterType,
) => {
  await db
    .update(gbpImportJobs)
    .set({ [counter]: sql`${gbpImportJobs[counter]} + 1`, updatedAt: new Date() })
    .where(
      and(eq(gbpImportJobs.organizationId, organizationId), eq(gbpImportJobs.id, jobId)),
    )
}

// ── Slug generation ────────────────────────────────────────────────

function generatePropertySlug(businessName: string, gbpPlaceId: string): string {
  const baseSlug = normalizeSlug(businessName)
  const slugSuffix = createHash('sha256')
    .update(gbpPlaceId)
    .digest('base64url')
    .slice(0, 8)
  return `${baseSlug}-${slugSuffix}`
}

// ── Single location processing ─────────────────────────────────────

async function processLocation(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  connectionId: string,
  jobId: string,
  location: { gbpPlaceId: string; businessName: string },
  existingGbpPlaceIds: Set<string>,
): Promise<void> {
  // Skip if already exists
  if (existingGbpPlaceIds.has(location.gbpPlaceId)) {
    await incrementJobCounter(db, organizationId, jobId, 'skippedCount')
    return
  }

  const slug = generatePropertySlug(location.businessName, location.gbpPlaceId)

  await db.insert(properties).values({
    organizationId,
    name: location.businessName,
    slug,
    timezone: 'UTC',
    gbpPlaceId: location.gbpPlaceId,
    googleConnectionId: connectionId,
  })

  await incrementJobCounter(db, organizationId, jobId, 'importedCount')
}

async function handleLocationError(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  jobId: string,
  location: { gbpPlaceId: string; businessName: string },
  err: unknown,
): Promise<void> {
  const isPg23505 =
    err instanceof Error && 'code' in err && (err as { code: string }).code === '23505'

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

  await incrementJobCounter(
    db,
    organizationId,
    jobId,
    treatAsSkip ? 'skippedCount' : 'failedCount',
  )
}

// ── Terminal status determination ──────────────────────────────────

function determineTerminalStatus(
  totalCount: number,
  skippedCount: number,
  failedCount: number,
): string {
  if (totalCount === 0) return 'failed'
  if (failedCount >= totalCount) return 'failed'
  if (failedCount > 0) return 'completed_with_failures'
  if (skippedCount > 0) return 'completed_with_skips'
  return 'completed'
}

// ── Job status updates ─────────────────────────────────────────────

async function markJobInProgress(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  jobId: string,
): Promise<void> {
  await db
    .update(gbpImportJobs)
    .set({ status: 'in_progress', updatedAt: new Date() })
    .where(
      and(eq(gbpImportJobs.organizationId, organizationId), eq(gbpImportJobs.id, jobId)),
    )
}

async function finalizeJobStatus(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  jobId: string,
): Promise<void> {
  const [jobRow] = await db
    .select({
      failedCount: gbpImportJobs.failedCount,
      importedCount: gbpImportJobs.importedCount,
      skippedCount: gbpImportJobs.skippedCount,
      totalCount: gbpImportJobs.totalCount,
    })
    .from(gbpImportJobs)
    .where(
      and(eq(gbpImportJobs.organizationId, organizationId), eq(gbpImportJobs.id, jobId)),
    )

  const finalStatus = jobRow
    ? determineTerminalStatus(jobRow.totalCount, jobRow.skippedCount, jobRow.failedCount)
    : 'failed'

  await db
    .update(gbpImportJobs)
    .set({
      status: finalStatus as
        | 'failed'
        | 'completed'
        | 'completed_with_skips'
        | 'completed_with_failures',
      updatedAt: new Date(),
    })
    .where(
      and(eq(gbpImportJobs.organizationId, organizationId), eq(gbpImportJobs.id, jobId)),
    )
}

async function markJobFailed(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  jobId: string,
): Promise<void> {
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

// ── Main handler ───────────────────────────────────────────────────

export const importPropertyHandler: JobHandler<ImportPropertyJobData> = async (
  job: Job<ImportPropertyJobData>,
) => {
  const { jobId, organizationId, connectionId, locations } = job.data
  const db = getDb()
  const logger = getLogger()

  await markJobInProgress(db, organizationId, jobId)

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

    const existingGbpPlaceIds = new Set(
      existingProperties
        .map((p) => p.gbpPlaceId)
        .filter((id): id is string => id !== null),
    )

    for (const location of locations) {
      try {
        await processLocation(
          db,
          organizationId,
          connectionId,
          jobId,
          location,
          existingGbpPlaceIds,
        )
      } catch (err) {
        await handleLocationError(db, organizationId, jobId, location, err)
      }
    }

    await finalizeJobStatus(db, organizationId, jobId)
  } catch (err) {
    logger.error({ err, jobId, organizationId }, 'Import handler crashed unexpectedly')
    await markJobFailed(db, organizationId, jobId)
  }
}
