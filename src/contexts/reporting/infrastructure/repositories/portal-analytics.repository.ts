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
  avg,
  count,
  eq,
  gte,
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
  MetricPortalRatingTrendPoint,
  PortalAnalyticsRepository,
  PortalRatingBucket,
} from '../../application/ports/portal-analytics.repository'
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

  async getPortalRatingTrend(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly MetricPortalRatingTrendPoint[]> {
    return trace('metric.portalAnalytics.getPortalRatingTrend', async () => {
      const correctionTips = currentCorrectionTips(db)
      const value = effectiveValue(correctionTips)
      const rows = await withStatementTimeout(db, (tx) =>
        tx
          .select({
            // property_local_date is computed per row from properties.timezone
            // (metric/infrastructure/repositories/property-local-date.ts) off the
            // EVENT time, and is required by the governed-provenance CHECK. Bucket
            // on it rather than DATE(recorded_at): the latter is the ingestion
            // timestamp evaluated in the UTC session timezone, so for a property in
            // e.g. America/Los_Angeles every action from 17:00 local onward landed
            // on the next day.
            date: metricReadings.propertyLocalDate,
            avgRating: sql<number>`ROUND(${avg(value)}::NUMERIC, 1)`,
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
              isNotNull(metricReadings.propertyLocalDate),
              sql`${value} BETWEEN 1 AND 5 AND ${value} = TRUNC(${value})`,
            ),
          )
          .groupBy(metricReadings.propertyLocalDate)
          .orderBy(metricReadings.propertyLocalDate),
      )

      // property_local_date is nullable in drizzle (pre-governance legacy rows);
      // the isNotNull predicate above already excludes them, so this narrows
      // without an assertion rather than inventing a date.
      return rows.flatMap((r) =>
        r.date === null ? [] : [{ date: r.date, avgRating: Number(r.avgRating ?? 0) }],
      )
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
