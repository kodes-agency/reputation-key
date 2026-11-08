import {
  currentCorrectionTips,
  effectiveValue,
  effectiveSampleCount,
} from '../readings/effective-readings.server'
import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { metricReadings } from '#/shared/db/schema/metric.schema'
import type {
  GoalMetricAggregateQuery,
  MetricRepository,
} from '../../application/ports/metric.repository'
import { unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

/** Aggregate columns come back as driver-typed values; an absent row reads as zero. */
function numberOrZero(value: unknown): number {
  return Number(value ?? 0)
}

function dateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  const parsed = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Goal metric aggregate contains an invalid correction timestamp')
  }
  return parsed
}

export const createMetricRepository = (
  db: Pick<Database, 'select'>,
): MetricRepository => ({
  queryGoalAggregate: async (query) =>
    trace('metric.queryGoalAggregate', async () => {
      const [row] = await goalMetricAggregateQuery(db, query)

      return {
        sum: numberOrZero(row?.sum),
        weightedSum: numberOrZero(row?.weightedSum),
        sampleCount: numberOrZero(row?.sampleCount),
        readingCount: numberOrZero(row?.readingCount),
        approximateCount: numberOrZero(row?.approximateCount),
        updatingCount: numberOrZero(row?.updatingCount),
        invalidQualityCount: numberOrZero(row?.invalidQualityCount),
        invalidSampleCount: numberOrZero(row?.invalidSampleCount),
        invalidSourceCount: numberOrZero(row?.invalidSourceCount),
        invalidDefinitionCount: numberOrZero(row?.invalidDefinitionCount),
        correctionHead: dateOrNull(row?.correctionHead),
      }
    }),

  hasReading: async (query) =>
    trace('metric.hasReading', async () => {
      const rows = await db
        .select({ id: metricReadings.id })
        .from(metricReadings)
        .where(
          and(
            eq(metricReadings.definitionVersionId, query.definitionVersionId),
            eq(metricReadings.sourceEventId, query.sourceEventId),
            eq(metricReadings.organizationId, unbrand(query.organizationId)),
          ),
        )
        .limit(1)
      return rows.length > 0
    }),
})

/** Shared by single and set-based governed snapshots. */
export function goalMetricAggregateQuery(
  db: Pick<Database, 'select'>,
  query: GoalMetricAggregateQuery,
) {
  const correctionTips = currentCorrectionTips(db)

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
      conditions.push(eq(metricReadings.groupId, unbrand(query.subject.portalGroupId)))
      break
    case 'portal':
      conditions.push(eq(metricReadings.portalId, unbrand(query.subject.portalId)))
      break
  }

  const value = effectiveValue(correctionTips)
  const sampleCount = effectiveSampleCount(correctionTips)
  const sourceAllowed =
    query.allowedSourcePolicies.length > 0
      ? inArray(metricReadings.sourcePolicy, [...query.allowedSourcePolicies])
      : sql`false`

  return db
    .select({
      sum: sql<number>`COALESCE(SUM(${value}), 0)`.as('sum'),
      weightedSum: sql<number>`COALESCE(SUM(${value} * ${sampleCount}), 0)`.as(
        'weightedSum',
      ),
      sampleCount: sql<number>`COALESCE(SUM(${sampleCount}), 0)`.as('sampleCount'),
      readingCount: sql<number>`CAST(COUNT(${value}) AS INTEGER)`.as('readingCount'),
      approximateCount: sql<number>`CAST(COUNT(${value}) FILTER (
            WHERE ${metricReadings.dataQuality} = 'approximate'
          ) AS INTEGER)`.as('approximateCount'),
      updatingCount: sql<number>`CAST(COUNT(${value}) FILTER (
            WHERE ${metricReadings.dataQuality} IN ('delayed', 'reconciling')
          ) AS INTEGER)`.as('updatingCount'),
      invalidQualityCount: sql<number>`CAST(COUNT(${value}) FILTER (
            WHERE ${metricReadings.dataQuality} IS NULL
               OR ${metricReadings.dataQuality} NOT IN ('exact', 'approximate', 'delayed', 'reconciling')
          ) AS INTEGER)`.as('invalidQualityCount'),
      invalidSampleCount: sql<number>`CAST(COUNT(${value}) FILTER (
            WHERE ${metricReadings.sampleCount} IS NULL OR ${metricReadings.sampleCount} < 0
          ) AS INTEGER)`.as('invalidSampleCount'),
      invalidSourceCount: sql<number>`CAST(COUNT(${value}) FILTER (
            WHERE ${metricReadings.sourcePolicy} IS NULL OR NOT (${sourceAllowed})
          ) AS INTEGER)`.as('invalidSourceCount'),
      invalidDefinitionCount: sql<number>`CAST(COUNT(${value}) FILTER (
            WHERE ${metricReadings.metricKey} <> ${query.expectedMetricKey}
          ) AS INTEGER)`.as('invalidDefinitionCount'),
      correctionHead: sql<unknown>`MAX(${correctionTips.recordedAt})`.as(
        'correctionHead',
      ),
    })
    .from(metricReadings)
    .leftJoin(correctionTips, eq(correctionTips.readingId, metricReadings.id))
    .where(and(...conditions))
}
