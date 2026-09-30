// Metric context — governed Portal analytics repository.
// This owner pins immutable definition versions, registry consumer/source
// policy, exact quality, current correction tips, half-open business time,
// tenant scope, and a statement-level budget. What it shares with the batched
// Portals overview lives in portal-analytics-shared.ts.
// TRAP: `metricReadings.occurredAt` is the INGESTION column (`recorded_at`);
// the guest-action time is `metricReadings.eventAt`; every period below is
// bounded on that business timestamp.

import type { Database, Tx } from '#/shared/db'
import { metricReadings } from '#/shared/db/schema'
import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'
import { portalMetricEvidenceSql } from './portal-analytics-evidence.sql'
import {
  PORTAL_DESTINATION_CLICK_KEY,
  PORTAL_RATING_KEY,
  QUALIFIED_SCAN_POLICY,
  countedPortalReadingWhere,
  currentCorrectionTips,
  effectiveValue,
  foldEvidenceRows,
  governedPortalWhere,
  portalEvidenceFamilies,
  withStatementTimeout,
  type EvidenceRow,
} from './portal-analytics-shared'
import type {
  MetricPortalMetricEvidenceSet,
  PortalAnalyticsRepository,
  PortalRatingBucket,
} from '../../application/ports/portal-analytics.repository'
import {
  SERIES_BUCKET_DAYS,
  type SeriesReadingRow,
} from '../../domain/portal-results-series'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'

function metricPortalWhere(
  organizationId: OrganizationId,
  propertyId: PropertyId,
  portalId: PortalId,
  startDate: Date,
  endDate: Date,
) {
  return and(
    eq(metricReadings.organizationId, organizationId),
    eq(metricReadings.propertyId, propertyId),
    eq(metricReadings.portalId, portalId),
    gte(metricReadings.eventAt, startDate),
    lt(metricReadings.eventAt, endDate),
  )
}

async function countUnattributedClicks(
  db: Database,
  tx: Tx,
  scope: SQL | undefined,
): Promise<number> {
  const correctionTips = currentCorrectionTips(db)
  const value = effectiveValue(correctionTips)
  const [row] = await tx
    .select({ total: count(value) })
    .from(metricReadings)
    .leftJoin(correctionTips, eq(correctionTips.readingId, metricReadings.id))
    .where(
      and(
        governedPortalWhere(scope),
        eq(metricReadings.metricKey, PORTAL_DESTINATION_CLICK_KEY),
        isNull(metricReadings.portalDestinationKind),
      ),
    )
  return Number(row?.total ?? 0)
}

export const createPortalAnalyticsRepository = (
  db: Database,
  clock: () => Date,
): PortalAnalyticsRepository => ({
  async getPortalKpiSums(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ) {
    return trace('metric.portalAnalytics.getPortalKpiSums', async () => {
      const correctionTips = currentCorrectionTips(db)
      const value = effectiveValue(correctionTips)
      const scope = governedPortalWhere(
        metricPortalWhere(organizationId, propertyId, portalId, startDate, endDate),
      )
      const rows = await withStatementTimeout(db, (tx) =>
        tx
          .select({
            metricKey: metricReadings.metricKey,
            total: sql<number>`SUM(${value})`,
            count: count(value),
          })
          .from(metricReadings)
          .leftJoin(correctionTips, eq(correctionTips.readingId, metricReadings.id))
          .where(and(scope, countedPortalReadingWhere(value)))
          .groupBy(metricReadings.metricKey),
      )
      return rows.map((row) => ({
        metricKey: row.metricKey,
        total: Number(row.total ?? 0),
        count: Number(row.count ?? 0),
      }))
    })
  },

  async getPortalRatingDistribution(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly PortalRatingBucket[]> {
    return trace('metric.portalAnalytics.getPortalRatingDistribution', async () => {
      const correctionTips = currentCorrectionTips(db)
      const value = effectiveValue(correctionTips)
      const ratingStars = sql<number>`CAST(${value} AS INTEGER)`
      const rows = await withStatementTimeout(db, (tx) =>
        tx
          .select({
            stars: ratingStars,
            count: count(),
          })
          .from(metricReadings)
          .leftJoin(correctionTips, eq(correctionTips.readingId, metricReadings.id))
          .where(
            and(
              governedPortalWhere(
                metricPortalWhere(
                  organizationId,
                  propertyId,
                  portalId,
                  startDate,
                  endDate,
                ),
              ),
              eq(metricReadings.metricKey, PORTAL_RATING_KEY),
              sql`${value} BETWEEN 1 AND 5 AND ${value} = TRUNC(${value})`,
            ),
          )
          .groupBy(ratingStars)
          .orderBy(ratingStars),
      )

      return rows.map((r) => ({
        stars: Number(r.stars),
        count: Number(r.count),
      }))
    })
  },

  async getPortalWeeklyReadings(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
    startLocalDate: string,
  ): Promise<readonly SeriesReadingRow[]> {
    return trace('metric.portalAnalytics.getPortalWeeklyReadings', async () => {
      const correctionTips = currentCorrectionTips(db)
      const value = effectiveValue(correctionTips)
      // Weeks are counted on `property_local_date`, which is computed per row
      // from the Property's time zone off the EVENT time (and required by the
      // governed-provenance CHECK), never on the UTC ingestion day. Date minus
      // date is whole days; integer division floors, and nothing here precedes
      // the window's first local day.
      const bucket = sql<number>`((${metricReadings.propertyLocalDate}::date - ${startLocalDate}::date) / ${sql.raw(String(SERIES_BUCKET_DAYS))})`
      const rows = await withStatementTimeout(db, (tx) =>
        tx
          .select({
            bucket,
            metricKey: metricReadings.metricKey,
            total: sql<number>`SUM(${value})`,
            count: count(value),
          })
          .from(metricReadings)
          .leftJoin(correctionTips, eq(correctionTips.readingId, metricReadings.id))
          .where(
            and(
              governedPortalWhere(
                metricPortalWhere(
                  organizationId,
                  propertyId,
                  portalId,
                  startDate,
                  endDate,
                ),
              ),
              inArray(metricReadings.metricKey, [
                QUALIFIED_SCAN_POLICY.metric.definition.key,
                PORTAL_RATING_KEY,
              ]),
              isNotNull(metricReadings.propertyLocalDate),
              countedPortalReadingWhere(value),
            ),
          )
          // By position: the bucket expression carries a bound parameter, and
          // the planner cannot match two copies of it.
          .groupBy(sql`1`, sql`2`)
          .orderBy(sql`1`, sql`2`),
      )
      return rows.map((row) => ({
        bucket: Number(row.bucket),
        metricKey: row.metricKey,
        total: Number(row.total ?? 0),
        count: Number(row.count ?? 0),
      }))
    })
  },

  async getPortalMetricEvidence(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<MetricPortalMetricEvidenceSet> {
    return trace('metric.portalAnalytics.getPortalMetricEvidence', async () => {
      const computedAt = clock()
      const { result, unattributedClicks } = await withStatementTimeout(
        db,
        async (tx) => ({
          unattributedClicks: await countUnattributedClicks(
            db,
            tx,
            metricPortalWhere(organizationId, propertyId, portalId, startDate, endDate),
          ),
          result: await tx.execute(
            portalMetricEvidenceSql(portalEvidenceFamilies(), {
              organizationId,
              portalIds: [portalId],
              propertyIds: [propertyId],
              startDate,
              endDate,
            }),
          ),
        }),
      )

      // The database prints a uuid lower-cased; the statement's rows say so too.
      const key = portalId.toLowerCase()
      const evidence = foldEvidenceRows(
        result.rows as EvidenceRow[],
        [key],
        new Map([[key, unattributedClicks]]),
        computedAt,
      ).get(key)
      if (!evidence) throw new Error('Portal metric evidence is incomplete')
      return evidence
    })
  },
})
