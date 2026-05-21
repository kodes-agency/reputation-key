// Metric context — Drizzle metric repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Raw metric readings are insert-only (no updates, no deletes).
//
// Query limits:
//   500 — findByOrganizationId: per-request page size. Matches typical query needs
//         for dashboard charts. Paginate (cursor on recorded_at) if exceeded.

import { eq, and, desc } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { metricReadings } from '#/shared/db/schema/metric.schema'
import type { MetricRepository } from '../../application/ports/metric.repository'
import type { MetricKey, MetricReading } from '../../domain/types'
import { trace } from '#/shared/observability/trace'

const VALID_METRIC_KEYS: Set<string> = new Set([
  'portal.scan',
  'portal.rating',
  'portal.feedback',
  'portal.review_link_click',
  'property.review',
])

function readingFromRow(row: typeof metricReadings.$inferSelect): MetricReading {
  if (!VALID_METRIC_KEYS.has(row.metricKey)) {
    throw new Error(`Invalid metric_key in DB row: ${row.metricKey}`)
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    portalId: row.portalId,
    metricKey: row.metricKey as MetricKey,
    value: row.value,
    recordedAt: row.recordedAt,
  }
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
})
