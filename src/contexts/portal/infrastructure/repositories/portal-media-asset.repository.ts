// Portal context — portal_media_assets Drizzle repository.
// Every query filters by organization_id (tenant isolation).

import { and, count, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalMediaAssets } from '#/shared/db/schema/portal-assets.schema'
import { unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { PortalMediaAssetRepository } from '../../application/ports/portal-media-asset.repository'
import {
  portalMediaAssetFromRow,
  portalMediaAssetToRow,
} from '../mappers/portal-media-asset.mapper'

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
})
