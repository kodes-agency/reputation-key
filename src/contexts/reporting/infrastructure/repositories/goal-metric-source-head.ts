import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { GoalMetricAggregateQuery } from '../../application/ports/metric.repository'

type SourceScope = Pick<
  GoalMetricAggregateQuery,
  'definitionVersionId' | 'periodStart' | 'periodEnd'
> &
  Readonly<{
    organizationId: string
    propertyId: string
  }>

/** Include every fact, receipt, projection and correction, even unchanged totals. */
function goalMetricSourceHeadQuery(scope: SourceScope, eventTypes: readonly string[]) {
  const types = sql.join(
    eventTypes.map((type) => sql`${type}`),
    sql`, `,
  )
  return sql<string>`
    SELECT encode(sha256(convert_to(
      jsonb_build_array(${scope.organizationId}::text, ${scope.propertyId}::uuid,
        ${scope.definitionVersionId}::uuid, ${scope.periodStart}::timestamptz,
        ${scope.periodEnd}::timestamptz)::text
      || COALESCE(string_agg(head.part, ',' ORDER BY head.part), ''), 'UTF8'
    )), 'hex') AS value
    FROM (
      SELECT jsonb_build_array('source', source.id, source.event_type,
        source.payload, receipt.status)::text AS part
      FROM outbox_events AS source
      LEFT JOIN event_consumer_receipts AS receipt
        ON receipt.event_id = source.id AND receipt.consumer_name = 'metric.guest-analytics'
      WHERE source.organization_id = ${scope.organizationId}
        AND source.property_id = ${scope.propertyId}
        AND source.source_context = 'guest'
        AND source.event_type IN (${types})
        AND (source.payload ->> 'occurredAt')::timestamptz >= ${scope.periodStart}
        AND (source.payload ->> 'occurredAt')::timestamptz < ${scope.periodEnd}
      UNION ALL
      SELECT jsonb_build_array('reading', to_jsonb(reading))::text
      FROM metric_readings AS reading
      WHERE reading.organization_id = ${scope.organizationId}
        AND reading.property_id = ${scope.propertyId}::uuid
        AND reading.definition_version_id = ${scope.definitionVersionId}::uuid
        AND reading.event_at >= ${scope.periodStart} AND reading.event_at < ${scope.periodEnd}
      UNION ALL
      SELECT jsonb_build_array('correction', to_jsonb(correction))::text
      FROM metric_corrections AS correction
      JOIN metric_readings AS reading ON reading.id = correction.reading_id
      WHERE reading.organization_id = ${scope.organizationId}
        AND reading.property_id = ${scope.propertyId}::uuid
        AND reading.definition_version_id = ${scope.definitionVersionId}::uuid
        AND reading.event_at >= ${scope.periodStart} AND reading.event_at < ${scope.periodEnd}
    ) AS head
  `
}

export function goalMetricSourceHead(scope: SourceScope, eventTypes: readonly string[]) {
  return sql<string>`(${goalMetricSourceHeadQuery(scope, eventTypes)})`
}

export async function readGoalMetricSourceHead(
  db: Pick<Database, 'execute'>,
  scope: SourceScope,
  eventTypes: readonly string[],
) {
  const head = await db.execute(goalMetricSourceHeadQuery(scope, eventTypes))
  const value = head.rows[0]?.['value']
  if (typeof value !== 'string') throw new Error('Goal metric source head is missing')
  return { value, eventTypes }
}
