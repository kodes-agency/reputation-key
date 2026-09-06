/**
 * MetricKey shared module — the identifiers accepted by Metric ingestion and
 * governed reads.
 */

// ── Types ────────────────────────────────────────────────────────────────

export type MetricKey =
  | 'portal.scan'
  | 'portal.rating'
  | 'portal.qualified_scan'
  | 'portal.rating_count'
  | 'portal.rating_average'
  | 'portal.feedback'
  | 'portal.review_link_click'
  | 'property.review'
  | 'portal.content_review.completed'
  | 'portal.configuration_completeness'
  | 'portal.approved_destination_ratio'

// ── Constants ────────────────────────────────────────────────────────────

export const METRIC_KEYS: readonly MetricKey[] = [
  'portal.scan',
  'portal.rating',
  'portal.qualified_scan',
  'portal.rating_count',
  'portal.rating_average',
  'portal.feedback',
  'portal.review_link_click',
  'property.review',
  'portal.content_review.completed',
  'portal.configuration_completeness',
  'portal.approved_destination_ratio',
] as const
