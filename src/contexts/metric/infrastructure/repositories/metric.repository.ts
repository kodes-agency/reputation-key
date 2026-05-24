// Metric context — Drizzle metric repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Raw metric readings are insert-only (no updates, no deletes).
//
// Query limits:
//   500 — findByOrganizationId: per-request page size. Matches typical query needs
//         for dashboard charts. Paginate (cursor on recorded_at) if exceeded.

import { eq, and, desc, sql, gte, lte } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { metricReadings } from '#/shared/db/schema/metric.schema'
import type { MetricRepository } from '../../application/ports/metric.repository'
import type { MetricKey, MetricReading } from '../../domain/types'
import {
  metricReadingId,
  organizationId as orgIdCtor,
  propertyId as propIdCtor,
  portalId as portalIdCtor,
  staffId as staffIdCtor,
} from '#/shared/domain/ids'
import { createMetricReading } from '../../domain/constructors'
import { trace } from '#/shared/observability/trace'

const VALID_METRIC_KEYS: Set<string> = new Set([
  'portal.scan',
  'portal.rating',
  'portal.feedback',
  'portal.review_link_click',
  'property.review',
])

function readingFromRow(row: typeof metricReadings.$inferSelect) {
  if (!VALID_METRIC_KEYS.has(row.metricKey)) {
    throw new Error(`Invalid metric_key in DB row: ${row.metricKey}`)
  }
  const result = createMetricReading({
    id: metricReadingId(row.id),
    organizationId: orgIdCtor(row.organizationId),
    propertyId: propIdCtor(row.propertyId),
    portalId: row.portalId ? portalIdCtor(row.portalId) : null,
    metricKey: row.metricKey as MetricKey,
    value: row.value,
    staffId: row.staffId ? staffIdCtor(row.staffId) : null,
    recordedAt: row.recordedAt,
  })
  if (result.isErr()) {
    throw new Error(`Invalid metric reading from DB: ${result.error.message}`)
  }
  return result.value
}

export const createMetricRepository = (db: Database): MetricRepository => ({
  insertReading: async (reading) => {
    return trace('metric.insertReading', async () => {
      const result = await db
        .insert(metricReadings)
        .values({
          organizationId: reading.organizationId,
          propertyId: reading.propertyId,
          portalId: reading.portalId,
          metricKey: reading.metricKey,
          value: reading.value,
          staffId: reading.staffId,
          recordedAt: reading.recordedAt,
        })
        .returning()

      if (!result[0]) {
        throw new Error('Metric reading insert failed — no row returned')
      }

      return readingFromRow(result[0])
    })
  },

  findByOrganizationId: async (orgId, metricKey) => {
    return trace('metric.findByOrganizationId', async () => {
      const where = metricKey
        ? and(
            eq(metricReadings.organizationId, orgId),
            eq(metricReadings.metricKey, metricKey),
          )
        : eq(metricReadings.organizationId, orgId)

      const rows = await db
        .select()
        .from(metricReadings)
        .where(where)
        .orderBy(desc(metricReadings.recordedAt))
        .limit(500)

      return rows.map(readingFromRow) satisfies ReadonlyArray<MetricReading>
    })
  },

  queryAggregate: async (query) => {
    return trace('metric.queryAggregate', async () => {
      const conditions = [
        eq(metricReadings.organizationId, query.organizationId),
        eq(metricReadings.propertyId, query.propertyId),
        eq(metricReadings.metricKey, query.metricKey),
      ]

      if (query.portalId) {
        conditions.push(eq(metricReadings.portalId, query.portalId))
      }
      if (query.staffId) {
        conditions.push(eq(metricReadings.staffId, query.staffId))
      }
      if (query.periodStart) {
        conditions.push(gte(metricReadings.recordedAt, query.periodStart))
      }
      if (query.periodEnd) {
        conditions.push(lte(metricReadings.recordedAt, query.periodEnd))
      }
      if (query.rollingWindowDays) {
        conditions.push(
          gte(
            metricReadings.recordedAt,
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
