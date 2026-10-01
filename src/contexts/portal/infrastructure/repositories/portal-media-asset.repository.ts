// Portal context — portal_media_assets Drizzle repository.
// Every query filters by organization_id (tenant isolation).

import { and, asc, count, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalMediaAssets } from '#/shared/db/schema/portal-assets.schema'
import {
  portalLinks,
  propertyPortalBrandProfiles,
} from '#/shared/db/schema/portal.schema'
import { portalPublicationSnapshots } from '#/shared/db/schema/portal-publication.schema'
import { portalMediaAssetId, unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { PortalMediaAssetRepository } from '../../application/ports/portal-media-asset.repository'
import {
  portalMediaAssetFromRow,
  portalMediaAssetToRow,
} from '../mappers/portal-media-asset.mapper'

/** Postgres's SQLSTATE for a foreign key violation. */
const FOREIGN_KEY_VIOLATION = '23503'

const isForeignKeyViolation = (error: unknown): boolean => {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null) ?? null
  return (
    code?.code === FOREIGN_KEY_VIOLATION || code?.cause?.code === FOREIGN_KEY_VIOLATION
  )
}

/**
 * True when nothing refers to the asset: no Brand Profile or link of its
 * Property, and no publication snapshot of its Property that names it. A snapshot
 * is immutable and must keep rendering and verifying, so what one names is kept
 * for as long as it exists. The snapshot's media sit at brandProfile.logo,
 * brandProfile.hero and links[].imageAssetId (schema version 3); older versions
 * have none of those paths and name nothing.
 */
const hasNoReference = sql`
  NOT EXISTS (
    SELECT 1 FROM ${propertyPortalBrandProfiles}
    WHERE ${propertyPortalBrandProfiles.organizationId} = ${portalMediaAssets.organizationId}
      AND ${propertyPortalBrandProfiles.propertyId} = ${portalMediaAssets.propertyId}
      AND (${propertyPortalBrandProfiles.logoAssetId} = ${portalMediaAssets.id}
        OR ${propertyPortalBrandProfiles.heroAssetId} = ${portalMediaAssets.id})
  )
  AND NOT EXISTS (
    SELECT 1 FROM ${portalLinks}
    WHERE ${portalLinks.organizationId} = ${portalMediaAssets.organizationId}
      AND ${portalLinks.propertyId} = ${portalMediaAssets.propertyId}
      AND ${portalLinks.imageAssetId} = ${portalMediaAssets.id}
  )
  AND NOT EXISTS (
    SELECT 1 FROM ${portalPublicationSnapshots}
    WHERE ${portalPublicationSnapshots.organizationId} = ${portalMediaAssets.organizationId}
      AND ${portalPublicationSnapshots.propertyId} = ${portalMediaAssets.propertyId}
      AND (
        ${portalPublicationSnapshots.configuration} #>> '{brandProfile,logo,assetId}'
          = ${portalMediaAssets.id}::text
        OR ${portalPublicationSnapshots.configuration} #>> '{brandProfile,hero,assetId}'
          = ${portalMediaAssets.id}::text
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(${portalPublicationSnapshots.configuration} -> 'links') = 'array'
                 THEN ${portalPublicationSnapshots.configuration} -> 'links'
                 ELSE '[]'::jsonb END
          ) AS link(value)
          WHERE link.value ->> 'imageAssetId' = ${portalMediaAssets.id}::text
        )
      )
  )
`

export const createPortalMediaAssetRepository = (
  db: Database,
): PortalMediaAssetRepository => ({
  insert: (asset) =>
    trace('portalMediaAsset.insert', async () => {
      await db.insert(portalMediaAssets).values(portalMediaAssetToRow(asset))
    }),

  findById: (organizationId, assetId) =>
    trace('portalMediaAsset.findById', async () => {
      const [row] = await db
        .select()
        .from(portalMediaAssets)
        .where(
          and(
            eq(portalMediaAssets.organizationId, unbrand(organizationId)),
            eq(portalMediaAssets.id, unbrand(assetId)),
          ),
        )
        .limit(1)
      return row ? portalMediaAssetFromRow(row) : null
    }),

  countActiveForProperty: (organizationId, propertyId) =>
    trace('portalMediaAsset.countActiveForProperty', async () => {
      const [row] = await db
        .select({ total: count() })
        .from(portalMediaAssets)
        .where(
          and(
            eq(portalMediaAssets.organizationId, unbrand(organizationId)),
            eq(portalMediaAssets.propertyId, unbrand(propertyId)),
            eq(portalMediaAssets.status, 'active'),
          ),
        )
      return row?.total ?? 0
    }),
  findForPublicRead: (assetId) =>
    trace('portalMediaAsset.findForPublicRead', async () => {
      const [row] = await db
        .select()
        .from(portalMediaAssets)
        .where(eq(portalMediaAssets.id, unbrand(assetId)))
        .limit(1)
      return row ? portalMediaAssetFromRow(row) : null
    }),

  listServableIds: (organizationId, propertyId, assetIds) =>
    trace('portalMediaAsset.listServableIds', async () => {
      if (assetIds.length === 0) return []
      const rows = await db
        .select({ id: portalMediaAssets.id })
        .from(portalMediaAssets)
        .where(
          and(
            eq(portalMediaAssets.organizationId, unbrand(organizationId)),
            eq(portalMediaAssets.propertyId, unbrand(propertyId)),
            eq(portalMediaAssets.status, 'active'),
            inArray(portalMediaAssets.id, assetIds.map(unbrand)),
          ),
        )
      return rows.map((row) => portalMediaAssetId(row.id))
    }),

  markTakenDown: (organizationId, assetId, at) =>
    trace('portalMediaAsset.markTakenDown', async () => {
      const [row] = await db
        .update(portalMediaAssets)
        .set({ status: 'taken_down', takenDownAt: at })
        .where(
          and(
            eq(portalMediaAssets.organizationId, unbrand(organizationId)),
            eq(portalMediaAssets.id, unbrand(assetId)),
            eq(portalMediaAssets.status, 'active'),
          ),
        )
        .returning()
      return row ? portalMediaAssetFromRow(row) : null
    }),

  markObjectDeleted: (organizationId, assetId, at) =>
    trace('portalMediaAsset.markObjectDeleted', async () => {
      await db
        .update(portalMediaAssets)
        .set({ objectDeletedAt: at })
        .where(
          and(
            eq(portalMediaAssets.organizationId, unbrand(organizationId)),
            eq(portalMediaAssets.id, unbrand(assetId)),
            eq(portalMediaAssets.status, 'taken_down'),
            isNull(portalMediaAssets.objectDeletedAt),
          ),
        )
    }),

  listTakenDownWithObject: (limit) =>
    trace('portalMediaAsset.listTakenDownWithObject', async () => {
      const rows = await db
        .select()
        .from(portalMediaAssets)
        .where(
          and(
            eq(portalMediaAssets.status, 'taken_down'),
            isNull(portalMediaAssets.objectDeletedAt),
            isNotNull(portalMediaAssets.takenDownAt),
          ),
        )
        .orderBy(asc(portalMediaAssets.takenDownAt), asc(portalMediaAssets.id))
        .limit(limit)
      return rows.map(portalMediaAssetFromRow)
    }),

  listUnreferencedBefore: (cutoff, limit) =>
    trace('portalMediaAsset.listUnreferencedBefore', async () => {
      const rows = await db
        .select()
        .from(portalMediaAssets)
        .where(
          and(
            eq(portalMediaAssets.status, 'active'),
            lt(portalMediaAssets.createdAt, cutoff),
            hasNoReference,
          ),
        )
        .orderBy(asc(portalMediaAssets.createdAt), asc(portalMediaAssets.id))
        .limit(limit)
      return rows.map(portalMediaAssetFromRow)
    }),

  discardIfUnreferenced: (asset, cutoff, removeObject) =>
    trace('portalMediaAsset.discardIfUnreferenced', async () => {
      try {
        return await db.transaction(async (tx) => {
          // The delete takes the row's lock, so a writer attaching the asset now
          // waits and then finds it gone; and the foreign keys refuse the delete
          // of an asset attached after the check. The object goes before the
          // commit, so a failed removal rolls the delete back and keeps the row.
          const [deleted] = await tx
            .delete(portalMediaAssets)
            .where(
              and(
                eq(portalMediaAssets.organizationId, unbrand(asset.organizationId)),
                eq(portalMediaAssets.id, unbrand(asset.id)),
                eq(portalMediaAssets.status, 'active'),
                lt(portalMediaAssets.createdAt, cutoff),
                hasNoReference,
              ),
            )
            .returning({ objectKey: portalMediaAssets.objectKey })
          if (!deleted) return false
          await removeObject(deleted.objectKey)
          return true
        })
      } catch (error) {
        if (isForeignKeyViolation(error)) return false
        throw error
      }
    }),
})
