import { sql, type SQLWrapper } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { metricCorrections, metricReadings } from '#/shared/db/schema/metric.schema'

function correctionIsCurrent(id: SQLWrapper) {
  return sql`NOT EXISTS (
    SELECT 1 FROM metric_corrections AS successor
    WHERE successor.supersedes_correction_id = ${id}
  )`
}

export function currentCorrectionTips(db: Pick<Database, 'select'>) {
  return db
    .select({
      readingId: metricCorrections.readingId,
      kind: metricCorrections.kind,
      exactDelta: metricCorrections.exactDelta,
      replacementValue: metricCorrections.replacementValue,
      recordedAt: metricCorrections.recordedAt,
    })
    .from(metricCorrections)
    .where(correctionIsCurrent(metricCorrections.id))
    .as('metric_correction_tips')
}

type CorrectionValue = Readonly<{
  kind: SQLWrapper
  replacementValue: SQLWrapper
  exactDelta: SQLWrapper
}>

/** Adjustments are relative to the original reading, not the previous correction. */
export function effectiveValue(
  tip: CorrectionValue,
  exactValue: SQLWrapper = metricReadings.exactValue,
) {
  return sql<number>`CASE
    WHEN ${tip.kind} = 'retract' THEN NULL
    WHEN ${tip.kind} = 'replace' THEN ${tip.replacementValue}
    WHEN ${tip.kind} = 'adjust' THEN ${exactValue} + ${tip.exactDelta}
    ELSE ${exactValue}
  END`
}

export function effectiveSampleCount(tip: Pick<CorrectionValue, 'kind'>) {
  return sql<number>`CASE
    WHEN ${tip.kind} = 'retract' THEN 0
    ELSE ${metricReadings.sampleCount}
  END`
}

/** Raw statements use fixed aliases: `readings` for the reading and `tip` for its correction. */
export const correctionTipJoin = sql`
  LEFT JOIN metric_corrections AS tip
    ON tip.reading_id = readings.id AND ${correctionIsCurrent(sql`tip.id`)}
`

export const effectiveReadingValue = effectiveValue(
  {
    kind: sql`tip.kind`,
    replacementValue: sql`tip.replacement_value`,
    exactDelta: sql`tip.exact_delta`,
  },
  sql`readings.exact_value`,
)

/** Staff figures retain the last correction visible strictly before their daily cutoff. */
export function asOfCorrectionTipJoin(cutoff: Date | null) {
  return sql`LEFT JOIN LATERAL (
    SELECT kind, replacement_value, exact_delta
    FROM metric_corrections AS correction
    WHERE correction.reading_id = readings.id
      AND (${cutoff}::timestamptz IS NULL OR correction.recorded_at < ${cutoff}::timestamptz)
    ORDER BY correction.recorded_at DESC, correction.id DESC
    LIMIT 1
  ) AS tip ON true`
}
