-- Migration 0008: Replace materialized views with incremental rollup tables
-- PRE17C: Materialized views use REFRESH MATERIALIZED VIEW CONCURRENTLY which
-- recomputes the entire view on each refresh. At target scale (5K properties,
-- 500K reviews/month), this becomes O(n) in total row count — unsustainable.
--
-- Rollup tables are maintained incrementally: only dates with new data since
-- the last watermark are recomputed. This is O(changed partitions), not O(total).
--
-- The dashboard does not currently query the matviews — it reads metric_readings
-- and inbox_items directly. These rollup tables are available for future
-- dashboard optimization and for any consumer that needs pre-aggregated data.

-- ── rollup_daily_metrics ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rollup_daily_metrics (
  organization_id text NOT NULL,
  property_id text NOT NULL,
  portal_id text NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  metric_key text NOT NULL,
  date timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  sum_value real NOT NULL DEFAULT 0,
  avg_value real NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, property_id, portal_id, metric_key, date)
);

-- ── rollup_weekly_metrics ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rollup_weekly_metrics (
  organization_id text NOT NULL,
  property_id text NOT NULL,
  portal_id text NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  metric_key text NOT NULL,
  week timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  sum_value real NOT NULL DEFAULT 0,
  avg_value real NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, property_id, portal_id, metric_key, week)
);

-- ── rollup_daily_inbox_metrics ────────────────────────────────────
CREATE TABLE IF NOT EXISTS rollup_daily_inbox_metrics (
  organization_id text NOT NULL,
  property_id text NOT NULL,
  date timestamptz NOT NULL,
  open_count integer NOT NULL DEFAULT 0,
  closed_count integer NOT NULL DEFAULT 0,
  escalated_count integer NOT NULL DEFAULT 0,
  avg_response_hours real,
  PRIMARY KEY (organization_id, property_id, date)
);

-- ── Watermark tracking ────────────────────────────────────────────
-- Each rollup has a watermark: the timestamp up to which source data has been
-- processed. Incremental refresh only processes rows newer than the watermark.
-- Initial watermark is epoch (1970-01-01) so the first run processes all data.
CREATE TABLE IF NOT EXISTS _rollup_watermarks (
  name text PRIMARY KEY,
  watermark timestamptz NOT NULL DEFAULT '1970-01-01'::timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO _rollup_watermarks (name) VALUES
  ('daily_metrics'),
  ('weekly_metrics'),
  ('daily_inbox_metrics')
ON CONFLICT DO NOTHING;

-- ── Drop materialized views ───────────────────────────────────────
-- The matviews are superseded by the rollup tables. Drop them and their
-- unique indexes. The refresh job is updated to maintain rollup tables
-- incrementally instead of calling REFRESH MATERIALIZED VIEW.
DROP MATERIALIZED VIEW IF EXISTS mv_daily_metrics;
DROP MATERIALIZED VIEW IF EXISTS mv_weekly_metrics;
DROP MATERIALIZED VIEW IF EXISTS mv_daily_inbox_metrics;

-- Helpful index for incremental refresh: find new rows efficiently
CREATE INDEX IF NOT EXISTS metric_readings_recorded_at_idx
  ON metric_readings (recorded_at);

CREATE INDEX IF NOT EXISTS inbox_items_source_date_idx
  ON inbox_items (source_date);
