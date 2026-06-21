-- Phase 2: Add missing composite and FK indexes for dashboard, badge, leaderboard, and portal queries.
-- All indexes are CREATE INDEX IF NOT EXISTS (safe to re-run).

-- CRITICAL: Composite index for dashboard review aggregation queries.
-- Covers getPeriodStats, getRatingDistribution, getRatingTrend, getReviewVolume,
-- getReplyPerformance, getRecentReviews, getUnansweredReviewCount.
CREATE INDEX IF NOT EXISTS reviews_org_property_reviewed_idx
  ON reviews (organization_id, property_id, reviewed_at);

-- FK index: reviews.google_connection_id
CREATE INDEX IF NOT EXISTS reviews_google_connection_idx
  ON reviews (google_connection_id);

-- HIGH: Composite indexes for dashboard metric queries (getSumsByPeriod).
CREATE INDEX IF NOT EXISTS metric_readings_org_prop_recorded_idx
  ON metric_readings (organization_id, property_id, recorded_at);

-- Index for portal-group-scoped badge/leaderboard queries.
CREATE INDEX IF NOT EXISTS metric_readings_org_group_idx
  ON metric_readings (organization_id, group_id);

-- MEDIUM: Composite index for attention signal count queries.
CREATE INDEX IF NOT EXISTS inbox_items_org_property_status_idx
  ON inbox_items (organization_id, property_id, status);

-- FK indexes: portal link categories and links.
CREATE INDEX IF NOT EXISTS portal_link_categories_portal_idx
  ON portal_link_categories (portal_id);
CREATE INDEX IF NOT EXISTS portal_links_portal_idx
  ON portal_links (portal_id);
CREATE INDEX IF NOT EXISTS portal_links_category_idx
  ON portal_links (category_id);

-- FK indexes: guest-facing tables.
CREATE INDEX IF NOT EXISTS scan_events_portal_idx
  ON scan_events (portal_id);
CREATE INDEX IF NOT EXISTS ratings_portal_idx
  ON ratings (portal_id);
CREATE INDEX IF NOT EXISTS feedback_portal_idx
  ON feedback (portal_id);

-- FK indexes: staff assignments.
CREATE INDEX IF NOT EXISTS staff_assignments_org_team_idx
  ON staff_assignments (organization_id, team_id);
CREATE INDEX IF NOT EXISTS staff_assignments_org_portal_idx
  ON staff_assignments (organization_id, portal_id);

-- FK index: goals by portal.
CREATE INDEX IF NOT EXISTS goals_org_portal_idx
  ON goals (organization_id, portal_id);
