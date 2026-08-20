-- Governed metric registry seed and conservative legacy reconciliation.
-- DDL is isolated in 0017; this data migration is idempotent.

INSERT INTO metric_definitions (
  id, metric_key, display_name, entity_level, value_type, description,
  value_kind, worker_data_flag, privacy_class, retention_class,
  lifecycle_status, approval_owner
)
VALUES
  ('11111111-1111-4111-8111-111111110101', 'portal.content_review.completed', 'Portal content reviews completed', 'property', 'counter', 'Explicit manager confirmation that published Portal content was reviewed.', 'counter', false, 'operational', 'standard', 'approved', 'product-governance'),
  ('11111111-1111-4111-8111-111111110102', 'portal.configuration_completeness', 'Portal configuration completeness', 'property', 'level', 'Published required configuration fields completed as a percentage.', 'level', false, 'operational', 'standard', 'approved', 'product-governance'),
  ('11111111-1111-4111-8111-111111110103', 'portal.approved_destination_ratio', 'Approved Portal destination ratio', 'property', 'ratio', 'Approved destinations divided by configured destinations.', 'ratio', false, 'operational', 'standard', 'approved', 'product-governance'),
  ('11111111-1111-4111-8111-111111110201', 'portal.scan', 'Portal scans', 'portal', 'counter', 'Portal scan operational analytics only.', 'counter', false, 'solicitation_analytics', 'short', 'approved', 'product-governance'),
  ('11111111-1111-4111-8111-111111110202', 'portal.rating', 'Private Portal ratings', 'portal', 'average', 'Private guest rating aggregate for Portal analytics only.', 'average', false, 'private_response', 'short', 'approved', 'privacy'),
  ('11111111-1111-4111-8111-111111110203', 'portal.feedback', 'Private Portal feedback count', 'portal', 'counter', 'Private guest response count for Portal analytics only; no response content.', 'counter', false, 'private_response', 'short', 'approved', 'privacy'),
  ('11111111-1111-4111-8111-111111110204', 'portal.review_link_click', 'Portal destination clicks', 'portal', 'counter', 'Portal destination click operational analytics only.', 'counter', false, 'solicitation_analytics', 'short', 'approved', 'product-governance'),
  ('11111111-1111-4111-8111-111111110205', 'property.review', 'Imported property reviews', 'property', 'average', 'Imported Google review aggregate for governed property Dashboard use only.', 'average', false, 'google_restricted', 'provider-aligned', 'approved', 'privacy')
ON CONFLICT (metric_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  value_kind = EXCLUDED.value_kind,
  worker_data_flag = EXCLUDED.worker_data_flag,
  privacy_class = EXCLUDED.privacy_class,
  retention_class = EXCLUDED.retention_class,
  lifecycle_status = EXCLUDED.lifecycle_status,
  approval_owner = EXCLUDED.approval_owner;

WITH seeds (
  version_id, metric_key, numerator_description, denominator_description,
  unit, precision, aggregation_rule, allowed_scopes, attribution_rule,
  minimum_sample, source_policy_allowlist, permitted_consumers
) AS (
  VALUES
    ('11111111-1111-4111-8111-111111111101'::uuid, 'portal.content_review.completed', 'Explicit manager content-reviewed action', NULL, 'review', 0, 'sum', '["property","portal_group"]'::jsonb, 'property and effective Portal group at event time', 1, '["first_party_workflow"]'::jsonb, '["dashboard","goal","badge","leaderboard","notification"]'::jsonb),
    ('11111111-1111-4111-8111-111111111102'::uuid, 'portal.configuration_completeness', 'Published required fields present', 'Published required fields configured', 'percent', 2, 'latest', '["property","portal_group"]'::jsonb, 'property and effective Portal group at event time', 1, '["first_party_workflow"]'::jsonb, '["dashboard","goal","badge","leaderboard","notification"]'::jsonb),
    ('11111111-1111-4111-8111-111111111103'::uuid, 'portal.approved_destination_ratio', 'Approved published destinations', 'Configured published destinations', 'ratio', 4, 'latest', '["property","portal_group"]'::jsonb, 'property and effective Portal group at event time', 5, '["first_party_workflow"]'::jsonb, '["dashboard","goal","badge","leaderboard","notification"]'::jsonb),
    ('11111111-1111-4111-8111-111111111201'::uuid, 'portal.scan', 'Portal scans', NULL, 'scan', 0, 'sum', '["property","portal","portal_group"]'::jsonb, 'portal and property at event time', 1, '["review_solicitation_analytics_only"]'::jsonb, '["portal_analytics"]'::jsonb),
    ('11111111-1111-4111-8111-111111111202'::uuid, 'portal.rating', 'Private rating total', 'Private rating response count', 'rating', 2, 'average', '["portal"]'::jsonb, 'portal at response time', 5, '["first_party_guest_private"]'::jsonb, '["portal_analytics"]'::jsonb),
    ('11111111-1111-4111-8111-111111111203'::uuid, 'portal.feedback', 'Private responses received', NULL, 'response', 0, 'sum', '["portal"]'::jsonb, 'portal at response time', 5, '["first_party_guest_private"]'::jsonb, '["portal_analytics"]'::jsonb),
    ('11111111-1111-4111-8111-111111111204'::uuid, 'portal.review_link_click', 'Published destination clicks', NULL, 'click', 0, 'sum', '["portal"]'::jsonb, 'portal at click time', 1, '["review_solicitation_analytics_only"]'::jsonb, '["portal_analytics"]'::jsonb),
    ('11111111-1111-4111-8111-111111111205'::uuid, 'property.review', 'Imported review rating total', 'Imported review count', 'rating', 2, 'average', '["property"]'::jsonb, 'source property identity', 1, '["google_property_derivative"]'::jsonb, '["dashboard"]'::jsonb)
)
INSERT INTO metric_definition_versions (
  id, definition_id, version, effective_from, effective_to,
  numerator_description, denominator_description, unit, precision,
  aggregation_rule, late_arrival_rule, allowed_scopes, attribution_rule,
  minimum_sample, insufficient_data_behavior, source_policy_allowlist,
  permitted_consumers, employment_decision_eligible, correction_behavior,
  fairness_review_status
)
SELECT
  seeds.version_id, definitions.id, 1, '2026-08-08T00:00:00Z', NULL,
  seeds.numerator_description, seeds.denominator_description, seeds.unit,
  seeds.precision, seeds.aggregation_rule, 'accept_with_source_event_time',
  seeds.allowed_scopes, seeds.attribution_rule, seeds.minimum_sample,
  'unavailable', seeds.source_policy_allowlist, seeds.permitted_consumers,
  false, 'append_delta', 'approved_for_consumers'
FROM seeds
JOIN metric_definitions definitions ON definitions.metric_key = seeds.metric_key
ON CONFLICT (id) DO NOTHING;

-- Legacy rows have no source event or immutable definition version. They are
-- retained for reconciliation but fail closed out of governed readers.
INSERT INTO metric_quarantine (
  source_event_id, organization_id, property_id, definition_version_id,
  source_policy, reason, payload_hash, event_at
)
SELECT
  'legacy:' || readings.id::text,
  readings.organization_id,
  readings.property_id,
  NULL,
  CASE
    WHEN readings.metric_key = 'property.review' THEN 'google_property_derivative'
    WHEN readings.metric_key IN ('portal.scan', 'portal.review_link_click') THEN 'review_solicitation_analytics_only'
    WHEN readings.metric_key IN ('portal.rating', 'portal.feedback') THEN 'first_party_guest_private'
    ELSE NULL
  END,
  'ambiguous_legacy_missing_source_event',
  md5(readings.id::text || ':' || readings.metric_key) || md5(readings.metric_key || ':' || readings.id::text),
  readings.recorded_at
FROM metric_readings readings
WHERE readings.definition_version_id IS NULL
ON CONFLICT (source_event_id, reason) DO NOTHING;