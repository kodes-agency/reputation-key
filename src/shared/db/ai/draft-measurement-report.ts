import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

export type DraftReportFilter = Readonly<{ since?: string; propertyId?: string }>

/** Queries only aggregate expressions. No row, identifier or text is returned. */
export async function readDraftMeasurementReport(
  db: Database,
  filter: DraftReportFilter,
): Promise<unknown> {
  const result = await db.execute(sql`
    WITH scoped AS (
      SELECT contract, trigger, "case", outcome, refusal_code, provider_attempts, latency_ms,
        adopted_at IS NOT NULL AS adopted, submitted_at IS NOT NULL AS submitted, edit_distance,
        published_at IS NOT NULL AS published, shown_at IS NOT NULL AS shown,
        dismissed_at IS NOT NULL AS dismissed, superseded_at IS NOT NULL AS superseded,
        draft_pressed, try_again_pressed, shorter_pressed, tone_pressed
      FROM ai_draft_measurements
      WHERE (${filter.since ?? null}::timestamptz IS NULL OR created_at >= ${filter.since ?? null}::timestamptz)
        AND (${filter.propertyId ?? null}::uuid IS NULL OR property_id = ${filter.propertyId ?? null}::uuid)
    ), groups AS (
      SELECT contract, trigger, "case", count(*) AS generations FROM scoped GROUP BY contract, trigger, "case"
    ), refusals AS (
      SELECT refusal_code, count(*) AS count FROM scoped WHERE outcome = 'refused' GROUP BY refusal_code
    ) SELECT jsonb_build_object(
      'generations', coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY contract, trigger, "case") FROM groups g), '[]'::jsonb),
      'refusals', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY refusal_code) FROM refusals r), '[]'::jsonb),
      'totals', count(*), 'adopted', count(*) FILTER (WHERE adopted),
      'adoptionRate', count(*) FILTER (WHERE adopted)::double precision / nullif(count(*) FILTER (WHERE outcome = 'ready'), 0),
      'editDistanceMedian', percentile_cont(0.5) WITHIN GROUP (ORDER BY edit_distance) FILTER (WHERE adopted),
      'editDistanceP90', percentile_cont(0.9) WITHIN GROUP (ORDER BY edit_distance) FILTER (WHERE adopted),
      'editDistanceUnavailable', count(*) FILTER (WHERE submitted AND edit_distance IS NULL),
      'sentUnchangedShare', count(*) FILTER (WHERE submitted AND edit_distance = 0)::double precision / nullif(count(*) FILTER (WHERE submitted AND edit_distance IS NOT NULL), 0),
      'rewriteRate', count(*) FILTER (WHERE provider_attempts = 2)::double precision / nullif(count(*), 0),
      'latencyMedianMs', percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms),
      'latencyP90Ms', percentile_cont(0.9) WITHIN GROUP (ORDER BY latency_ms),
      'latencyP99Ms', percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms),
      'shown', count(*) FILTER (WHERE shown), 'dismissed', count(*) FILTER (WHERE dismissed),
      'superseded', count(*) FILTER (WHERE superseded), 'submitted', count(*) FILTER (WHERE submitted),
      'published', count(*) FILTER (WHERE published),
      'buttons', jsonb_build_object('draft', count(*) FILTER (WHERE draft_pressed), 'try_again', count(*) FILTER (WHERE try_again_pressed), 'shorter', count(*) FILTER (WHERE shorter_pressed), 'tone', count(*) FILTER (WHERE tone_pressed))
    ) AS report FROM scoped
  `)
  return (result.rows[0] as { report: unknown }).report
}
