-- Beta-safe recognition metric and badge seeds. Kept separate from the
-- recognition DDL so the shipped 0025 migration remains immutable.

WITH recognition_metric_versions (
  id, metric_key, numerator_description, denominator_description, unit,
  precision, aggregation_rule, minimum_sample
) AS (
  VALUES
    ('11111111-1111-4111-8111-111111112101'::uuid, 'portal.content_review.completed', 'Explicit manager content-reviewed action', NULL, 'review', 0, 'sum', 1),
    ('11111111-1111-4111-8111-111111112102'::uuid, 'portal.configuration_completeness', 'Published required fields present', 'Published required fields configured', 'percent', 2, 'latest', 1),
    ('11111111-1111-4111-8111-111111112103'::uuid, 'portal.approved_destination_ratio', 'Approved published destinations', 'Configured published destinations', 'ratio', 4, 'ratio', 5)
)
INSERT INTO "metric_definition_versions" (
  "id", "definition_id", "version", "effective_from", "effective_to",
  "numerator_description", "denominator_description", "unit", "precision",
  "aggregation_rule", "late_arrival_rule", "allowed_scopes",
  "attribution_rule", "minimum_sample", "insufficient_data_behavior",
  "source_policy_allowlist", "permitted_consumers",
  "employment_decision_eligible", "correction_behavior",
  "fairness_review_status"
)
SELECT
  versions.id, definitions.id, 2, '2026-08-09T00:00:00Z', NULL,
  versions.numerator_description, versions.denominator_description,
  versions.unit, versions.precision, versions.aggregation_rule,
  'accept_with_source_event_time', '["property","portal_group"]'::jsonb,
  'property and effective Portal group at event time', versions.minimum_sample,
  'unavailable', '["first_party_workflow"]'::jsonb,
  '["dashboard","goal","recognition","notification"]'::jsonb,
  false, 'append_delta', 'approved_for_consumers'
FROM recognition_metric_versions versions
JOIN "metric_definitions" definitions ON definitions."metric_key" = versions.metric_key
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "badge_definitions" (
  "id", "key", "name", "description", "icon", "target_scope",
  "criteria_version", "criteria_json", "enabled", "created_at", "updated_at"
)
VALUES
  ('44444444-4444-4444-8444-444444444101', 'content_review_stewardship', 'Content Review Stewardship', 'Recognizes a portal group that completes governed content reviews.', 'clipboard-check', 'portal_group', 1, '{"type":"threshold","metricKey":"portal.content_review.completed","operator":">=","threshold":5,"aggregation":"sum","period":"this_month"}'::jsonb, true, now(), now()),
  ('44444444-4444-4444-8444-444444444102', 'configuration_ready', 'Configuration Ready', 'Recognizes complete, published portal-group configuration.', 'badge-check', 'portal_group', 1, '{"type":"threshold","metricKey":"portal.configuration_completeness","operator":">=","threshold":90,"aggregation":"max","period":"this_month"}'::jsonb, true, now(), now()),
  ('44444444-4444-4444-8444-444444444103', 'approved_destination_quality', 'Approved Destination Quality', 'Recognizes portal groups with a strong approved-destination ratio.', 'route', 'portal_group', 1, '{"type":"threshold","metricKey":"portal.approved_destination_ratio","operator":">=","threshold":0.8,"aggregation":"avg","period":"this_month"}'::jsonb, true, now(), now())
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "badge_definition_versions" (
  "id", "badge_definition_id", "version", "name", "icon", "criteria",
  "rule", "metric_definition_version_id", "aggregation", "threshold",
  "minimum_exposure", "minimum_sample", "freshness_seconds",
  "minimum_completeness", "effective_from", "effective_to",
  "employment_decision_eligible", "created_at"
)
VALUES
  ('55555555-5555-4555-8555-555555555101', (SELECT "id" FROM "badge_definitions" WHERE "key" = 'content_review_stewardship'), 1, 'Content Review Stewardship', 'clipboard-check', 'At least five governed content reviews in the period', 'sum >= 5', '11111111-1111-4111-8111-111111112101', 'sum', 5, 5, 5, 86400, 0.9, '2026-08-09T00:00:00Z', NULL, false, now()),
  ('55555555-5555-4555-8555-555555555102', (SELECT "id" FROM "badge_definitions" WHERE "key" = 'configuration_ready'), 1, 'Configuration Ready', 'badge-check', 'Published configuration is at least 90 percent complete', 'latest >= 90', '11111111-1111-4111-8111-111111112102', 'latest', 90, 5, 1, 86400, 0.9, '2026-08-09T00:00:00Z', NULL, false, now()),
  ('55555555-5555-4555-8555-555555555103', (SELECT "id" FROM "badge_definitions" WHERE "key" = 'approved_destination_quality'), 1, 'Approved Destination Quality', 'route', 'Approved destination ratio is at least 0.8', 'ratio >= 0.8', '11111111-1111-4111-8111-111111112103', 'ratio', 0.8, 5, 5, 86400, 0.9, '2026-08-09T00:00:00Z', NULL, false, now())
ON CONFLICT ("id") DO NOTHING;
