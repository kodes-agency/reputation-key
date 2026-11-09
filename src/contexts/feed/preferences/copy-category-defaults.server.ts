import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

export const DEFAULT_COPY_BATCH_SIZE = 500
export const MAX_COPY_BATCH_SIZE = 5000

export type CategoryDefaultCopyCounts = Readonly<{
  /** Defaults with no preference row yet. */
  missing: number
  /** Defaults whose preference row holds a different answer. */
  differing: number
}>

export type CategoryDefaultCopyResult = Readonly<{
  inserted: number
  updated: number
}>

const boundedBatchSize = (value: number | undefined): number => {
  const size = value ?? DEFAULT_COPY_BATCH_SIZE
  if (!Number.isInteger(size) || size < 1 || size > MAX_COPY_BATCH_SIZE) {
    throw new Error(`batch size must be an integer from 1 to ${MAX_COPY_BATCH_SIZE}`)
  }
  return size
}

// A default is out of step when its Property-less preference row is absent or
// answers differently. Both sides are compared on the same three values.
const outOfStep = sql`(p.id IS NULL OR (p.enabled, p.cadence, p.max_rating)
  IS DISTINCT FROM (d.enabled, d.cadence, d.max_rating))`

const joinMirror = sql`
  FROM notification_category_defaults d
  LEFT JOIN notification_preferences p
    ON p.user_id = d.user_id
   AND p.organization_id = d.organization_id
   AND p.property_id IS NULL
   AND p.category = d.category
   AND p.channel = d.channel`

/** Counts only: how many defaults a copy would still write. */
export async function countCategoryDefaultsToCopy(
  db: Database,
): Promise<CategoryDefaultCopyCounts> {
  const result = await db.execute(sql`
    SELECT count(*) FILTER (WHERE p.id IS NULL)::int AS missing,
           count(*) FILTER (WHERE p.id IS NOT NULL)::int AS differing
    ${joinMirror}
    WHERE ${outOfStep}
  `)
  const row = result.rows[0] as { missing: number; differing: number } | undefined
  return { missing: row?.missing ?? 0, differing: row?.differing ?? 0 }
}

/**
 * Copies each person's category defaults into preference rows with no
 * Property, a batch at a time. A row already holding the same answer is left
 * alone, so a second run writes nothing; a row left behind by a release that
 * only wrote the earlier table is brought up to date. Reports counts only.
 */
export async function copyCategoryDefaultsToPreferences(
  db: Database,
  options: Readonly<{ batchSize?: number }> = {},
): Promise<CategoryDefaultCopyResult> {
  const batchSize = boundedBatchSize(options.batchSize)
  let inserted = 0
  let updated = 0
  for (;;) {
    const result = await db.execute(sql`
      WITH batch AS (
        SELECT d.user_id, d.organization_id, d.category, d.channel, d.enabled,
               d.cadence, d.max_rating, d.created_at, d.updated_at
        ${joinMirror}
        WHERE ${outOfStep}
        ORDER BY d.id
        LIMIT ${batchSize}
      ),
      written AS (
        INSERT INTO notification_preferences (
          id, user_id, organization_id, property_id, category, channel,
          enabled, cadence, max_rating, created_at, updated_at
        )
        SELECT gen_random_uuid(), user_id, organization_id, NULL, category, channel,
               enabled, cadence, max_rating, created_at, updated_at
        FROM batch
        ON CONFLICT (user_id, organization_id, category, channel)
          WHERE property_id IS NULL
        DO UPDATE SET enabled = EXCLUDED.enabled,
                      cadence = EXCLUDED.cadence,
                      max_rating = EXCLUDED.max_rating,
                      updated_at = EXCLUDED.updated_at
        WHERE (notification_preferences.enabled, notification_preferences.cadence,
               notification_preferences.max_rating)
          IS DISTINCT FROM (EXCLUDED.enabled, EXCLUDED.cadence, EXCLUDED.max_rating)
        RETURNING (xmax = 0) AS was_inserted
      )
      SELECT count(*) FILTER (WHERE was_inserted)::int AS inserted,
             count(*) FILTER (WHERE NOT was_inserted)::int AS updated
      FROM written
    `)
    const row = result.rows[0] as { inserted: number; updated: number } | undefined
    const batchInserted = row?.inserted ?? 0
    const batchUpdated = row?.updated ?? 0
    inserted += batchInserted
    updated += batchUpdated
    if (batchInserted + batchUpdated === 0) break
  }
  return { inserted, updated }
}
