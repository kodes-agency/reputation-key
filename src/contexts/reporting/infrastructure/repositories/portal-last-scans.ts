import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import type { Database, Tx } from '#/shared/db'
import { metricReadings } from '#/shared/db/schema'
import type { OrganizationId } from '#/shared/domain/ids'
import {
  currentCorrectionTips,
  effectiveValue,
  governedPortalWhere,
  QUALIFIED_SCAN_POLICY,
} from '../../portal-results/portal-analytics-shared.server'
import type { PortalResultsPortal } from '../../application/ports/portal-results-overview.repository'

/** Last counted qualified arrival, across the retained history, with corrections applied. */
export async function readPortalLastScans(
  db: Database,
  tx: Tx,
  organizationId: OrganizationId,
  portals: readonly PortalResultsPortal[],
  at: Date,
) {
  const corrections = currentCorrectionTips(db)
  const value = effectiveValue(corrections)
  return tx
    .select({
      portalId: metricReadings.portalId,
      lastScanAt: sql<string>`max(${metricReadings.eventAt})`,
    })
    .from(metricReadings)
    .leftJoin(corrections, eq(corrections.readingId, metricReadings.id))
    .where(
      and(
        governedPortalWhere(
          and(
            eq(metricReadings.organizationId, organizationId),
            inArray(
              metricReadings.propertyId,
              portals.map((portal) => portal.propertyId),
            ),
            inArray(
              metricReadings.portalId,
              portals.map((portal) => portal.portalId),
            ),
            lt(metricReadings.eventAt, at),
          ),
        ),
        eq(metricReadings.definitionVersionId, QUALIFIED_SCAN_POLICY.metric.version.id),
        gt(value, 0),
      ),
    )
    .groupBy(metricReadings.portalId)
}
