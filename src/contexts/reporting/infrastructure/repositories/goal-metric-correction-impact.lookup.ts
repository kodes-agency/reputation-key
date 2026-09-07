import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { metricReadings } from '#/shared/db/schema/metric.schema'
import type {
  GoalMetricCorrectionImpact,
  GoalMetricCorrectionImpactLookup,
} from '../../application/ports/goal-metric-correction-impact.lookup'

export const createGoalMetricCorrectionImpactLookup = (
  db: Database,
): GoalMetricCorrectionImpactLookup => {
  return {
    async findGoalMetricCorrectionImpacts(input) {
      const readingIds = [
        input.correctedReadingId,
        ...(input.replacementReadingId ? [input.replacementReadingId] : []),
      ].filter((value, index, values) => values.indexOf(value) === index)
      const rows = await db
        .select({
          readingId: metricReadings.id,
          organizationId: metricReadings.organizationId,
          propertyId: metricReadings.propertyId,
          definitionVersionId: metricReadings.definitionVersionId,
          portalId: metricReadings.portalId,
          portalGroupId: metricReadings.groupId,
          eventAt: metricReadings.eventAt,
        })
        .from(metricReadings)
        .where(
          and(
            eq(metricReadings.organizationId, input.organizationId),
            eq(metricReadings.propertyId, input.propertyId),
            eq(metricReadings.definitionVersionId, input.definitionVersionId),
            inArray(metricReadings.id, readingIds),
          ),
        )

      if (
        rows.some(
          (row) =>
            row.organizationId !== input.organizationId ||
            row.propertyId !== input.propertyId ||
            row.definitionVersionId !== input.definitionVersionId ||
            !(row.eventAt instanceof Date) ||
            Number.isNaN(row.eventAt.getTime()),
        )
      ) {
        throw new Error('Metric correction impact attribution is invalid')
      }
      const byId = new Map(
        rows.map((row) => [row.readingId, row as GoalMetricCorrectionImpact]),
      )
      if (!byId.has(input.correctedReadingId)) {
        throw new Error('corrected Metric reading impact is unavailable')
      }
      if (input.replacementReadingId && !byId.has(input.replacementReadingId)) {
        throw new Error('replacement Metric reading impact is unavailable')
      }
      return readingIds.map((readingId) => byId.get(readingId)!)
    },
  }
}
