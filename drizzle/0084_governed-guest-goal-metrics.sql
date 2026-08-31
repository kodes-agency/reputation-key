ALTER TABLE "metric_definition_versions" DROP CONSTRAINT "metric_definition_versions_sample_check";--> statement-breakpoint
ALTER TABLE "metric_definition_versions" ADD CONSTRAINT "metric_definition_versions_sample_check" CHECK ("metric_definition_versions"."minimum_sample" >= 0);--> statement-breakpoint

-- These definitions do not reinterpret the older portal.scan / portal.rating
-- analytics. Distinct keys keep count and weighted-average semantics immutable.
INSERT INTO metric_definitions (
  id, metric_key, display_name, entity_level, value_type, description,
  value_kind, worker_data_flag, privacy_class, retention_class,
  lifecycle_status, approval_owner
)
VALUES
  (
    '11111111-1111-4111-8111-111111110301',
    'portal.qualified_scan',
    'Qualified scans',
    'portal',
    'counter',
    'Server-verified QR or NFC Access Artifact arrivals, deduplicated per response session and Portal over 24 hours.',
    'counter', false, 'deidentified_guest_gateway_numeric',
    'guest_gateway_24_month', 'approved', 'product-governance'
  ),
  (
    '11111111-1111-4111-8111-111111110302',
    'portal.rating_count',
    'Portal rating count',
    'portal',
    'counter',
    'Count of eligible first-party private numeric Portal ratings from every arrival channel.',
    'counter', false, 'deidentified_guest_gateway_numeric',
    'guest_gateway_24_month', 'approved', 'product-governance'
  ),
  (
    '11111111-1111-4111-8111-111111110303',
    'portal.rating_average',
    'Portal rating average',
    'portal',
    'average',
    'Rating-weighted average of eligible first-party private numeric Portal ratings from every arrival channel.',
    'average', false, 'deidentified_guest_gateway_numeric',
    'guest_gateway_24_month', 'approved', 'product-governance'
  )
ON CONFLICT (metric_key) DO NOTHING;--> statement-breakpoint

WITH seeds (
  version_id, metric_key, numerator_description, denominator_description,
  unit, precision, aggregation_rule, minimum_sample
) AS (
  VALUES
    (
      '11111111-1111-4111-8111-111111111301'::uuid,
      'portal.qualified_scan',
      'Eligible server-verified and session-deduplicated Access Artifact arrivals',
      NULL,
      'scan', 0, 'sum', 0
    ),
    (
      '11111111-1111-4111-8111-111111111302'::uuid,
      'portal.rating_count',
      'Eligible private numeric Portal ratings',
      NULL,
      'rating', 0, 'sum', 0
    ),
    (
      '11111111-1111-4111-8111-111111111303'::uuid,
      'portal.rating_average',
      'Sum of eligible private numeric Portal rating values',
      'Count of eligible private numeric Portal ratings',
      'star', 1, 'weighted_average', 10
    )
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
  seeds.version_id,
  definitions.id,
  1,
  '2026-08-25T00:00:00Z',
  NULL,
  seeds.numerator_description,
  seeds.denominator_description,
  seeds.unit,
  seeds.precision,
  seeds.aggregation_rule,
  'append_by_source_event_time_reconcile_24h_after_month_end',
  '["property","portal_group","portal"]'::jsonb,
  'property, Portal, and effective Portal Group at source-event time',
  seeds.minimum_sample,
  'unavailable',
  '["first_party_guest_gateway_metric"]'::jsonb,
  '["dashboard","goal","notification","export","portal_analytics"]'::jsonb,
  false,
  'append_delta',
  'approved_manager_context'
FROM seeds
JOIN metric_definitions definitions ON definitions.metric_key = seeds.metric_key
ON CONFLICT (id) DO NOTHING;
