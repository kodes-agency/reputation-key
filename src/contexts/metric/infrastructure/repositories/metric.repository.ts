import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  metricCorrections,
  metricDefinitionVersions,
  metricReadings,
} from '#/shared/db/schema/metric.schema'
import type { MetricRepository } from '../../application/ports/metric.repository'
import { unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

export const createMetricRepository = (
  db: Database,
  clock: () => Date,
): MetricRepository => ({
  queryAggregate: async (query) =>
    trace('metric.queryAggregate', async () => {
      const correctionTips = db
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
        .as('metric_correction_tips')

      const conditions = [
        eq(metricReadings.organizationId, unbrand(query.organizationId)),
        eq(metricReadings.propertyId, unbrand(query.propertyId)),
        eq(metricReadings.metricKey, query.metricKey),
        isNotNull(metricReadings.definitionVersionId),
        isNotNull(metricReadings.exactValue),
        sql`${metricDefinitionVersions.permittedConsumers} @> ${JSON.stringify([
          query.consumer,
        ])}::jsonb`,
      ]

      if (query.portalId) {
        conditions.push(eq(metricReadings.portalId, unbrand(query.portalId)))
      }
      if (query.groupId) {
        conditions.push(eq(metricReadings.groupId, unbrand(query.groupId)))
      }
      if (query.periodStart) {
        conditions.push(gte(metricReadings.eventAt, query.periodStart))
      }
      if (query.periodEnd) {
        conditions.push(lt(metricReadings.eventAt, query.periodEnd))
      }
      if (query.rollingWindowDays) {
        conditions.push(
          gte(
            metricReadings.eventAt,
            new Date(clock().getTime() - query.rollingWindowDays * 86_400_000),
          ),
        )
      }

      const effectiveValue = sql<number>`CASE
        WHEN ${correctionTips.kind} = 'retract' THEN NULL
        WHEN ${correctionTips.kind} = 'replace' THEN ${correctionTips.replacementValue}
        WHEN ${correctionTips.kind} = 'adjust' THEN ${metricReadings.exactValue} + ${correctionTips.exactDelta}
        ELSE ${metricReadings.exactValue}
      END`
      const effectiveSampleCount = sql<number>`CASE
        WHEN ${correctionTips.kind} = 'retract' THEN 0
        ELSE ${metricReadings.sampleCount}
      END`

      const rows = await db
        .select({
          sum: sql<number>`COALESCE(SUM(${effectiveValue}), 0)`,
          count: sql<number>`CAST(COUNT(${effectiveValue}) AS INTEGER)`,
          max: sql<number>`COALESCE(MAX(${effectiveValue}), 0)`,
          sampleCount: sql<number>`COALESCE(SUM(${effectiveSampleCount}), 0)`,
          minimumSample: sql<number>`COALESCE(MAX(${metricDefinitionVersions.minimumSample}), 1)`,
        })
        .from(metricReadings)
        .innerJoin(
          metricDefinitionVersions,
          eq(metricDefinitionVersions.id, metricReadings.definitionVersionId),
        )
        .leftJoin(correctionTips, eq(correctionTips.readingId, metricReadings.id))
        .where(and(...conditions))

      const sum = Number(rows[0]?.sum ?? 0)
      const count = Number(rows[0]?.count ?? 0)
      const max = Number(rows[0]?.max ?? 0)
      const sampleCount = Number(rows[0]?.sampleCount ?? 0)
      const minimumSample = Number(rows[0]?.minimumSample ?? 1)
      const available = sampleCount >= minimumSample

      return {
        sum: available ? sum : 0,
        count: available ? count : 0,
        max: available ? max : 0,
        available,
        sampleCount,
        minimumSample,
      }
    }),

  queryGoalAggregate: async (query) =>
    trace('metric.queryGoalAggregate', async () => {
      const correctionTips = db
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
        .as('goal_metric_correction_tips')

      const conditions = [
        eq(metricReadings.organizationId, unbrand(query.organizationId)),
        eq(metricReadings.propertyId, unbrand(query.propertyId)),
        eq(metricReadings.definitionVersionId, query.definitionVersionId),
        isNotNull(metricReadings.exactValue),
        gte(metricReadings.eventAt, query.periodStart),
        lt(metricReadings.eventAt, query.periodEnd),
      ]
      switch (query.subject.kind) {
        case 'property':
          break
        case 'portal_group':
          conditions.push(
            eq(metricReadings.groupId, unbrand(query.subject.portalGroupId)),
          )
          break
        case 'portal':
          conditions.push(eq(metricReadings.portalId, unbrand(query.subject.portalId)))
          break
      }

      const effectiveValue = sql<number>`CASE
        WHEN ${correctionTips.kind} = 'retract' THEN NULL
        WHEN ${correctionTips.kind} = 'replace' THEN ${correctionTips.replacementValue}
        WHEN ${correctionTips.kind} = 'adjust' THEN ${metricReadings.exactValue} + ${correctionTips.exactDelta}
        ELSE ${metricReadings.exactValue}
      END`
      const effectiveSampleCount = sql<number>`CASE
        WHEN ${correctionTips.kind} = 'retract' THEN 0
        ELSE ${metricReadings.sampleCount}
      END`
      const sourceAllowed =
        query.allowedSourcePolicies.length > 0
          ? inArray(metricReadings.sourcePolicy, [...query.allowedSourcePolicies])
          : sql`false`

      const [row] = await db
        .select({
          sum: sql<number>`COALESCE(SUM(${effectiveValue}), 0)`,
          weightedSum: sql<number>`COALESCE(SUM(${effectiveValue} * ${effectiveSampleCount}), 0)`,
          sampleCount: sql<number>`COALESCE(SUM(${effectiveSampleCount}), 0)`,
          readingCount: sql<number>`CAST(COUNT(${effectiveValue}) AS INTEGER)`,
          approximateCount: sql<number>`CAST(COUNT(${effectiveValue}) FILTER (
            WHERE ${metricReadings.dataQuality} = 'approximate'
          ) AS INTEGER)`,
          updatingCount: sql<number>`CAST(COUNT(${effectiveValue}) FILTER (
            WHERE ${metricReadings.dataQuality} IN ('delayed', 'reconciling')
          ) AS INTEGER)`,
          invalidQualityCount: sql<number>`CAST(COUNT(${effectiveValue}) FILTER (
            WHERE ${metricReadings.dataQuality} IS NULL
               OR ${metricReadings.dataQuality} NOT IN ('exact', 'approximate', 'delayed', 'reconciling')
          ) AS INTEGER)`,
          invalidSampleCount: sql<number>`CAST(COUNT(${effectiveValue}) FILTER (
            WHERE ${metricReadings.sampleCount} IS NULL OR ${metricReadings.sampleCount} < 0
          ) AS INTEGER)`,
          invalidSourceCount: sql<number>`CAST(COUNT(${effectiveValue}) FILTER (
            WHERE ${metricReadings.sourcePolicy} IS NULL OR NOT (${sourceAllowed})
          ) AS INTEGER)`,
          invalidDefinitionCount: sql<number>`CAST(COUNT(${effectiveValue}) FILTER (
            WHERE ${metricReadings.metricKey} <> ${query.expectedMetricKey}
          ) AS INTEGER)`,
        })
        .from(metricReadings)
        .leftJoin(correctionTips, eq(correctionTips.readingId, metricReadings.id))
        .where(and(...conditions))

      return {
        sum: Number(row?.sum ?? 0),
        weightedSum: Number(row?.weightedSum ?? 0),
        sampleCount: Number(row?.sampleCount ?? 0),
        readingCount: Number(row?.readingCount ?? 0),
        approximateCount: Number(row?.approximateCount ?? 0),
        updatingCount: Number(row?.updatingCount ?? 0),
        invalidQualityCount: Number(row?.invalidQualityCount ?? 0),
        invalidSampleCount: Number(row?.invalidSampleCount ?? 0),
        invalidSourceCount: Number(row?.invalidSourceCount ?? 0),
        invalidDefinitionCount: Number(row?.invalidDefinitionCount ?? 0),
      }
    }),
})
