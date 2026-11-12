import type { MetricRegistry } from '../../readings/contracts'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { GoalMetricAggregate } from '../../application/ports/metric.repository'
import {
  queryGoalMetric,
  prepareGoalMetricQuery,
  type GovernedGoalMetricQuery,
  type GovernedGoalMetricResult,
} from '../../application/use-cases/query-goal-metric'
import { goalMetricAggregateQuery } from './metric.repository'
import {
  evaluateGoalMetricSourceRows,
  goalMetricSourceStatusQuery,
} from './goal-metric-source-status'

/** Live figures share one repeatable-read snapshot and one statement per page. */
export function createGoalMetricBatchReader(
  db: Database,
  registry: MetricRegistry,
  clock: () => Date,
) {
  return async (
    queries: readonly GovernedGoalMetricQuery[],
  ): Promise<readonly GovernedGoalMetricResult[]> => {
    if (queries.length === 0) return []
    const organizationId = queries[0]!.organizationId
    if (queries.some((query) => query.organizationId !== organizationId)) {
      throw new Error('Goal metric batches must stay within one Organization')
    }
    const prepared = new Map<
      number,
      Parameters<Parameters<typeof queryGoalMetric>[0]['readSnapshot']>
    >()
    await Promise.all(
      queries.map(async (query, index) => {
        const plan = await prepareGoalMetricQuery(registry, query)
        if (!('state' in plan))
          prepared.set(index, [plan.aggregateQuery, plan.spec.eventTypes])
      }),
    )
    const statements = [...prepared].map(([index, [query, events]]) => {
      const subjectId =
        query.subject.kind === 'property'
          ? query.subject.propertyId
          : query.subject.kind === 'portal'
            ? query.subject.portalId
            : query.subject.portalGroupId
      const valid =
        query.subject.kind === 'property'
          ? sql`${subjectId} = ${query.propertyId}`
          : query.subject.kind === 'portal'
            ? sql`EXISTS (SELECT 1 FROM portals WHERE id = ${subjectId}::uuid AND organization_id = ${query.organizationId} AND property_id = ${query.propertyId}::uuid AND deleted_at IS NULL)`
            : sql`EXISTS (SELECT 1 FROM portal_groups WHERE id = ${subjectId}::uuid AND organization_id = ${query.organizationId} AND property_id = ${query.propertyId}::uuid AND deleted_at IS NULL)`
      return sql`SELECT ${index}::int AS index, ${valid} AS valid,
        ${query.organizationId}::text AS organization_id, to_jsonb(aggregate) AS aggregate,
        (SELECT coalesce(jsonb_agg(source), '[]'::jsonb) FROM (${goalMetricSourceStatusQuery(query, events)}) AS source) AS sources
        FROM (${goalMetricAggregateQuery(db, query).getSQL()}) AS aggregate
        WHERE EXISTS (SELECT 1 FROM properties AS property
          WHERE property.organization_id = ${query.organizationId}
            AND property.id = ${query.propertyId}::uuid)`
    })
    const rows =
      statements.length === 0
        ? []
        : await db.transaction(
            async (tx) => {
              const result =
                await tx.execute(sql`SELECT snapshots.* FROM (${sql.join(statements, sql` UNION ALL `)}) AS snapshots
                WHERE snapshots.organization_id = ${organizationId}`)
              return result.rows
            },
            { isolationLevel: 'repeatable read', accessMode: 'read only' },
          )
    const byIndex = new Map(rows.map((row) => [Number(row['index']), row]))
    return Promise.all(
      queries.map((query, index) =>
        queryGoalMetric({
          registry,
          clock,
          validateSubject: async () => byIndex.get(index)?.['valid'] === true,
          readSnapshot: async (aggregateQuery) => {
            const row = byIndex.get(index)
            if (!row) throw new Error('Goal metric snapshot is missing')
            const aggregate = row['aggregate'] as GoalMetricAggregate
            return {
              aggregate: {
                ...aggregate,
                correctionHead: aggregate.correctionHead
                  ? new Date(aggregate.correctionHead)
                  : null,
              },
              source: evaluateGoalMetricSourceRows(
                aggregateQuery,
                row['sources'] as Parameters<typeof evaluateGoalMetricSourceRows>[1],
              ),
            }
          },
        })(query),
      ),
    )
  }
}
