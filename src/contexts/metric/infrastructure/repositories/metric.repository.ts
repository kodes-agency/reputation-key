// Metric context — Drizzle metric repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Raw metric readings are insert-only (no updates, no deletes).

import { eq, and, sql, gte, lte } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { metricReadings } from '#/shared/db/schema/metric.schema'
import type { MetricRepository } from '../../application/ports/metric.repository'
import type { MetricKey } from '../../domain/types'
import {
  metricReadingId,
  organizationId as orgIdCtor,
  propertyId as propIdCtor,
  portalId as portalIdCtor,
  portalGroupId as groupIdCtor,
  unbrand,
} from '#/shared/domain/ids'
import { createMetricReading, VALID_METRIC_KEYS } from '../../domain/constructors'
import { metricError } from '../../domain/errors'
import { trace } from '#/shared/observability/trace'

function readingFromRow(row: typeof metricReadings.$inferSelect) {
  if (!VALID_METRIC_KEYS.has(row.metricKey as MetricKey)) {
    throw metricError(
      'unknown_metric_key',
      `Invalid metric_key in DB row: ${row.metricKey}`,
    )
  }
  return createMetricReading({
    id: metricReadingId(row.id),
    organizationId: orgIdCtor(row.organizationId),
    propertyId: propIdCtor(row.propertyId),
    portalId: row.portalId ? portalIdCtor(row.portalId) : null,
    metricKey: row.metricKey as MetricKey,
    value: row.value,
    groupId: row.groupId ? groupIdCtor(row.groupId) : null,
    occurredAt: row.occurredAt,
  })
}

export const createMetricRepository = (db: Database): MetricRepository => ({
  insertReading: async (reading) => {
    return trace('metric.insertReading', async () => {
      const result = await db
        .insert(metricReadings)
        .values({
          organizationId: unbrand(reading.organizationId),
          propertyId: unbrand(reading.propertyId),
          portalId: reading.portalId ? unbrand(reading.portalId) : null,
          metricKey: reading.metricKey,
          value: reading.value,
          groupId: reading.groupId ? unbrand(reading.groupId) : null,
          occurredAt: reading.occurredAt,
        })
        .returning()

      if (!result.length) {
        throw metricError(
          'repo_insert_failed',
          'Metric reading insert failed — no row returned',
        )
      }

      return readingFromRow(result[0])
    })
  },

  queryAggregate: async (query) => {
    return trace('metric.queryAggregate', async () => {
      const conditions = [
        eq(metricReadings.organizationId, unbrand(query.organizationId)),
        eq(metricReadings.propertyId, unbrand(query.propertyId)),
        eq(metricReadings.metricKey, query.metricKey),
      ]

      if (query.portalId) {
        conditions.push(eq(metricReadings.portalId, unbrand(query.portalId)))
      }
      if (query.groupId) {
        conditions.push(eq(metricReadings.groupId, unbrand(query.groupId)))
      }
      if (query.periodStart) {
        conditions.push(gte(metricReadings.occurredAt, query.periodStart))
      }
      if (query.periodEnd) {
        conditions.push(lte(metricReadings.occurredAt, query.periodEnd))
      }
      // F118: rollingWindowDays overrides periodEnd — compute rolling start
      // from NOW() and use it as the sole lower-bound (replaces periodEnd).
      if (query.rollingWindowDays) {
        conditions.push(
          gte(
            metricReadings.occurredAt,
            sql`NOW() - INTERVAL '1 day' * ${query.rollingWindowDays}`,
          ),
        )
      }

      const row = await db
        .select({
          sum: sql<number>`COALESCE(SUM(${metricReadings.value}), 0)`,
          count: sql<number>`CAST(COUNT(*) AS INTEGER)`,
          max: sql<number>`COALESCE(MAX(${metricReadings.value}), 0)`,
        })
        .from(metricReadings)
        .where(and(...conditions))

      return {
        sum: Number(row[0]?.sum ?? 0),
        count: Number(row[0]?.count ?? 0),
        max: Number(row[0]?.max ?? 0),
      }
    })
  },
})
