-- A counted tap on a Linktree link keeps which link it was (ADR 0044, amendment of
-- 2026-11-01). Only a secondary-link destination click carries one: a Google open has no
-- link, and every other reading has no destination. The id is a manager-owned object, not
-- guest data, and it deliberately has no foreign key: a reading outlives the link it names,
-- so taps on a removed link still count. metric_readings is small (23k rows on the beta in
-- November 2026), so the CHECK validates within the migration's lock budget.
ALTER TABLE metric_readings ADD COLUMN portal_link_id uuid;
--> statement-breakpoint
ALTER TABLE metric_readings ADD CONSTRAINT metric_readings_portal_link_check CHECK (
  portal_link_id IS NULL
  OR (metric_key = 'portal.review_link_click' AND portal_destination_kind = 'secondary_link')
);
