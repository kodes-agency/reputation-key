-- Fix M2: Create the 3 materialized views that refresh-materialized-view.job.ts targets.
-- The jobs use REFRESH MATERIALIZED VIEW CONCURRENTLY, which requires a unique index.
-- PRD docs/prd-phase-13.md §6 specifies these views.
-- Uses IF NOT EXISTS so it's safe to re-run.

-- ── mv_daily_metrics ──────────────────────────────────────────────
-- One row per (organization_id, property_id, portal_id, metric_key, date).
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_metrics AS
SELECT
  organization_id,
  property_id,
  COALESCE(portal_id, '00000000-0000-0000-0000-000000000000'::uuid) AS portal_id,
  metric_key,
  date_trunc('day', recorded_at) AS date,
  count(*)::integer AS count,
  sum(value)::real AS sum_value,
  avg(value)::real AS avg_value
FROM metric_readings
GROUP BY organization_id, property_id, COALESCE(portal_id, '00000000-0000-0000-0000-000000000000'::uuid), metric_key, date_trunc('day', recorded_at);

CREATE UNIQUE INDEX IF NOT EXISTS mv_daily_metrics_unique
  ON mv_daily_metrics (organization_id, property_id, portal_id, metric_key, date);

-- ── mv_weekly_metrics ─────────────────────────────────────────────
-- Same shape aggregated by ISO week.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_weekly_metrics AS
SELECT
  organization_id,
  property_id,
  COALESCE(portal_id, '00000000-0000-0000-0000-000000000000'::uuid) AS portal_id,
  metric_key,
  date_trunc('week', recorded_at) AS week,
  count(*)::integer AS count,
  sum(value)::real AS sum_value,
  avg(value)::real AS avg_value
FROM metric_readings
GROUP BY organization_id, property_id, COALESCE(portal_id, '00000000-0000-0000-0000-000000000000'::uuid), metric_key, date_trunc('week', recorded_at);

CREATE UNIQUE INDEX IF NOT EXISTS mv_weekly_metrics_unique
  ON mv_weekly_metrics (organization_id, property_id, portal_id, metric_key, week);

-- ── mv_daily_inbox_metrics ────────────────────────────────────────
-- Computed from inbox_items. Columns: org, property, date, open/closed counts,
-- active-escalation count, avg response hours (closed_at - created_at).
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_inbox_metrics AS
SELECT
  organization_id,
  property_id,
  date_trunc('day', source_date) AS date,
  count(*) FILTER (WHERE status = 'open')::integer AS open_count,
  count(*) FILTER (WHERE status = 'closed')::integer AS closed_count,
  count(*) FILTER (WHERE is_escalated = true AND escalation_resolved_at IS NULL)::integer AS escalated_count,
  avg(EXTRACT(EPOCH FROM (closed_at - created_at)) / 3600)::real AS avg_response_hours
FROM inbox_items
GROUP BY organization_id, property_id, date_trunc('day', source_date);

CREATE UNIQUE INDEX IF NOT EXISTS mv_daily_inbox_metrics_unique
  ON mv_daily_inbox_metrics (organization_id, property_id, date);

-- ── Fix M-PROP-003: GBP place ID uniqueness within org ────────────
CREATE UNIQUE INDEX IF NOT EXISTS properties_org_gbp_place_id_unique
  ON properties (organization_id, gbp_place_id)
  WHERE gbp_place_id IS NOT NULL AND deleted_at IS NULL;
