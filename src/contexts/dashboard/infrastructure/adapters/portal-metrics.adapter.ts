// Dashboard context — Drizzle adapter implementing PortalMetricsPort
// SQL queries against metric_readings table.
// This is the ONLY place dashboard infrastructure touches metric_readings for portal analytics.
// Scope predicates and the statement timeout come from the read facade. This
// adapter additionally pins immutable Portal-analytics definition versions,
// registry consumer/source policy, exact quality, and current correction tips.
// TRAP: `metricReadings.occurredAt` is the INGESTION column (`recorded_at`);
// the guest-action time is `metricReadings.eventAt`. metricPortalWhere bounds
// the window on event time — see the note on metricPeriodWhere in read-facade.

import type { Database } from '#/shared/db'
import {
  metricCorrections,
  metricDefinitionVersions,
  metricReadings,
} from '#/shared/db/schema'
import { and, eq, sql, count, avg, isNotNull, inArray } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'
import type {
  PortalMetricsPort,
  PortalRatingBucket,
  PortalRatingTrendPoint,
} from '../../application/ports/portal-metrics.port'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'
import {
  DASHBOARD_READ_BUDGET_MS,
  metricPortalWhere,
  withStatementTimeout,
} from '../read-facade'
import { METRIC_VERSION_IDS } from '#/contexts/metric/application/public-api'

const PORTAL_RATING_KEY = 'portal.rating'
const PORTAL_ANALYTICS_VERSION_IDS = [
  METRIC_VERSION_IDS.portalScanAnalytics,
  METRIC_VERSION_IDS.portalRatingAnalytics,
  METRIC_VERSION_IDS.portalFeedbackAnalytics,
  METRIC_VERSION_IDS.portalDestinationClickAnalytics,
] as const

function currentCorrectionTips(db: Database) {
  return db
    .select({
      readingId: metricCorrections.readingId,
      kind: metricCorrections.kind,
      exactDelta: metricCorrections.exactDelta,
      replacementValue: metricCorrections.replacementValue,
    })
    .from(metricCorrections)
    .where(
      sql`NOT EXISTS (
        SELECT 1
        FROM metric_corrections AS successor
        WHERE successor.supersedes_correction_id = ${metricCorrections.id}
      )`,
    )
    .as('portal_metric_correction_tips')
}

type CorrectionTips = ReturnType<typeof currentCorrectionTips>

function effectiveValue(correctionTips: CorrectionTips) {
  return sql<number>`CASE
    WHEN ${correctionTips.kind} = 'retract' THEN NULL
    WHEN ${correctionTips.kind} = 'replace' THEN ${correctionTips.replacementValue}
    WHEN ${correctionTips.kind} = 'adjust'
      THEN ${metricReadings.exactValue} + ${correctionTips.exactDelta}
    ELSE ${metricReadings.exactValue}
  END`
}

function governedPortalWhere(scope: ReturnType<typeof metricPortalWhere>) {
  return and(
    scope,
    inArray(metricReadings.definitionVersionId, PORTAL_ANALYTICS_VERSION_IDS),
    isNotNull(metricReadings.exactValue),
    eq(metricReadings.dataQuality, 'exact'),
    sql`${metricReadings.attributionQuality} <> 'unresolved'`,
    sql`${metricDefinitionVersions.permittedConsumers} @> '["portal_analytics"]'::jsonb`,
    sql`EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(
        ${metricDefinitionVersions.sourcePolicyAllowlist}
      ) AS allowed_policy(value)
      WHERE allowed_policy.value = ${metricReadings.sourcePolicy}
    )`,
  )
}

export const createPortalMetricsAdapter = (db: Database): PortalMetricsPort => ({
  async getPortalKpiSums(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ) {
    return trace('dashboard.portalMetrics.getPortalKpiSums', async () => {
      const correctionTips = currentCorrectionTips(db)
      const value = effectiveValue(correctionTips)
      const scope = governedPortalWhere(
        metricPortalWhere(organizationId, propertyId, portalId, startDate, endDate),
      )
      const rows = await withStatementTimeout(db, DASHBOARD_READ_BUDGET_MS, (tx) =>
        tx
          .select({
            metricKey: metricReadings.metricKey,
            total: sql<number>`SUM(${value})`,
            count: count(value),
          })
          .from(metricReadings)
          .innerJoin(
            metricDefinitionVersions,
            eq(metricDefinitionVersions.id, metricReadings.definitionVersionId),
          )
          .leftJoin(correctionTips, eq(correctionTips.readingId, metricReadings.id))
          .where(
            and(
              scope,
              sql`(${metricReadings.metricKey} <> ${PORTAL_RATING_KEY}
                OR (${value} BETWEEN 1 AND 5 AND ${value} = TRUNC(${value})))`,
            ),
          )
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
    return trace('dashboard.portalMetrics.getPortalRatingDistribution', async () => {
      const correctionTips = currentCorrectionTips(db)
      const value = effectiveValue(correctionTips)
      const ratingStars = sql<number>`CAST(${value} AS INTEGER)`
      const rows = await withStatementTimeout(db, DASHBOARD_READ_BUDGET_MS, (tx) =>
        tx
          .select({
            stars: ratingStars,
            count: count(),
          })
          .from(metricReadings)
          .innerJoin(
            metricDefinitionVersions,
            eq(metricDefinitionVersions.id, metricReadings.definitionVersionId),
          )
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
  ): Promise<readonly PortalRatingTrendPoint[]> {
    return trace('dashboard.portalMetrics.getPortalRatingTrend', async () => {
      const correctionTips = currentCorrectionTips(db)
      const value = effectiveValue(correctionTips)
      const rows = await withStatementTimeout(db, DASHBOARD_READ_BUDGET_MS, (tx) =>
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
          .innerJoin(
            metricDefinitionVersions,
            eq(metricDefinitionVersions.id, metricReadings.definitionVersionId),
          )
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
})
