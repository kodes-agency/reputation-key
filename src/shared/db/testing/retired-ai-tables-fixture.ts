import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

// Renaming inside a rolled-back transaction proves that SQL does not depend on
// these relations, without changing the migrated schema or deleting any rows.
const RETIRED_TABLES = [
  'ai_property_trend_scheduler_heads',
  'ai_property_trend_schedules',
  'ai_property_trend_outcomes',
  'ai_property_daily_aggregates',
  'ai_property_daily_aspect_aggregates',
  'ai_property_aggregate_contribution_aspects',
  'ai_review_analysis_aspects',
  'ai_property_review_population_daily',
] as const

class ProbeRolledBack extends Error {}

export async function withoutRetiredAiTables(
  db: Database,
  probe: (tx: Database) => Promise<void>,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      for (const table of RETIRED_TABLES) {
        await tx.execute(
          sql`ALTER TABLE ${sql.identifier(table)} RENAME TO ${sql.identifier(`retired_${table}`)}`,
        )
      }
      await probe(tx as unknown as Database)
      throw new ProbeRolledBack()
    })
  } catch (error) {
    if (!(error instanceof ProbeRolledBack)) throw error
  }
}
