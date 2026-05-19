import type { Job } from 'bullmq'
import type { JobHandler } from '#/shared/jobs/registry'
import type { ImportPropertyJobData } from '../../application/ports/gbp-queue.port'
import type { EventBus } from '#/shared/events/event-bus'

export type { ImportPropertyJobData }
import { createHash } from 'crypto'
import { getDb } from '#/shared/db'
import { properties, gbpImportJobs } from '#/shared/db/schema'
import { getLogger } from '#/shared/observability/logger'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { normalizeSlug } from '#/contexts/property/domain/rules'
import { propertyCreated } from '#/contexts/property/domain/events'
import { propertyId, organizationId as toOrgId } from '#/shared/domain/ids'

type CounterType = 'importedCount' | 'skippedCount' | 'failedCount'

type CreatedProperty = Readonly<{
  id: string
  organizationId: string
  name: string
  slug: string
  gbpPlaceId: string
  gbpLocationName: string
  googleConnectionId: string
  createdAt: Date
}>

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

function generatePropertySlug(businessName: string, gbpPlaceId: string): string {
  const baseSlug = normalizeSlug(businessName)
  const slugSuffix = createHash('sha256')
    .update(gbpPlaceId)
    .digest('base64url')
    .slice(0, 8)
  return `${baseSlug}-${slugSuffix}`
}

async function processLocation(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  connectionId: string,
  jobId: string,
  location: { gbpPlaceId: string; businessName: string; gbpLocationName: string },
  existingGbpPlaceIds: Set<string>,
): Promise<CreatedProperty | null> {
  if (existingGbpPlaceIds.has(location.gbpPlaceId)) {
    await incrementJobCounter(db, organizationId, jobId, 'skippedCount')
    return null
  }

  const slug = generatePropertySlug(location.businessName, location.gbpPlaceId)
  const now = new Date()

  const [inserted] = await db
    .insert(properties)
    .values({
      organizationId,
      name: location.businessName,
      slug,
      timezone: 'UTC',
      gbpPlaceId: location.gbpPlaceId,
      googleConnectionId: connectionId,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  await incrementJobCounter(db, organizationId, jobId, 'importedCount')

  return {
    id: inserted.id,
    organizationId: inserted.organizationId,
    name: inserted.name,
    slug: inserted.slug,
    gbpPlaceId: inserted.gbpPlaceId!,
    gbpLocationName: location.gbpLocationName,
    googleConnectionId: connectionId,
    createdAt: inserted.createdAt!,
  }
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

  let treatAsSkip = false
  if (isPg23505) {
    const race = await db
      .select({ id: properties.id })
      .from(properties)
      .where(
        and(
          eq(properties.organizationId, organizationId),
          eq(properties.gbpPlaceId, location.gbpPlaceId),
          isNull(properties.deletedAt),
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

type ImportPropertyHandlerDeps = Readonly<{
  events: EventBus
}>

export const createImportPropertyHandler = (
  deps: ImportPropertyHandlerDeps,
): JobHandler<ImportPropertyJobData> => {
  return async (job: Job<ImportPropertyJobData>) => {
    const { jobId, organizationId, connectionId, locations } = job.data
    const db = getDb()
    const logger = getLogger()

    await markJobInProgress(db, organizationId, jobId)

    const createdProperties: CreatedProperty[] = []

    try {
      const gbpPlaceIds = locations.map((loc) => loc.gbpPlaceId)
      const existingProperties = await db
        .select({ gbpPlaceId: properties.gbpPlaceId })
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, organizationId),
            isNull(properties.deletedAt),
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
          const created = await processLocation(
            db,
            organizationId,
            connectionId,
            jobId,
            location,
            existingGbpPlaceIds,
          )
          if (created) {
            createdProperties.push(created)
          }
        } catch (err) {
          await handleLocationError(db, organizationId, jobId, location, err)
        }
      }

      await finalizeJobStatus(db, organizationId, jobId)

      for (const prop of createdProperties) {
        try {
          await deps.events.emit(
            propertyCreated({
              propertyId: propertyId(prop.id),
              organizationId: toOrgId(prop.organizationId),
              name: prop.name,
              slug: prop.slug,
              gbpPlaceId: prop.gbpPlaceId,
              gbpLocationName: prop.gbpLocationName,
              googleConnectionId: prop.googleConnectionId,
              occurredAt: prop.createdAt,
            }),
          )
        } catch (err) {
          logger.warn(
            { err, propertyId: prop.id },
            'Failed to emit property.created event',
          )
        }
      }
    } catch (err) {
      logger.error({ err, jobId, organizationId }, 'Import handler crashed unexpectedly')
      await markJobFailed(db, organizationId, jobId)
    }
  }
}
