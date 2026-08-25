/**
 * MetricKey shared module — domain validation maps for goal metric selection.
 *
 * Centralises scope→key, key→aggregation, and default aggregation logic
 * so that goal constructors, server functions, and UI can all reference
 * the same validation rules without circular dependencies.
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

export type AggregationFunction = 'sum' | 'count' | 'max' | 'avg'

export type EntityScope = 'property' | 'portal_group' | 'portal'

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

export const AGGREGATION_FUNCTIONS: readonly AggregationFunction[] = [
  'sum',
  'count',
  'max',
  'avg',
] as const

/**
 * Metrics exposed by the beta GoalProgram creation experience. Private
 * feedback/contact, unqualified solicitation observations, Google-derived
 * analytics, and the superseded workflow-health goals never enter the beta
 * selector.
 */
export const BETA_GOAL_METRIC_KEYS_BY_SCOPE: Readonly<
  Record<EntityScope, readonly MetricKey[]>
> = {
  property: ['portal.qualified_scan', 'portal.rating_count', 'portal.rating_average'],
  portal_group: ['portal.qualified_scan', 'portal.rating_count', 'portal.rating_average'],
  portal: ['portal.qualified_scan', 'portal.rating_count', 'portal.rating_average'],
}

/**
 * Domain compatibility matrix for the legacy Goal aggregate. The legacy
 * workflow-health measures remain valid while existing records and jobs are
 * drained; new beta creation uses BETA_GOAL_METRIC_KEYS_BY_SCOPE instead.
 */
export const VALID_SCOPE_METRIC_KEYS: Readonly<
  Record<EntityScope, readonly MetricKey[]>
> = {
  property: [
    'portal.content_review.completed',
    'portal.configuration_completeness',
    'portal.approved_destination_ratio',
    ...BETA_GOAL_METRIC_KEYS_BY_SCOPE.property,
  ],
  portal_group: [
    'portal.content_review.completed',
    'portal.configuration_completeness',
    'portal.approved_destination_ratio',
    ...BETA_GOAL_METRIC_KEYS_BY_SCOPE.portal_group,
  ],
  portal: ['portal.qualified_scan', 'portal.rating_count', 'portal.rating_average'],
}

/**
 * Which aggregation functions are valid for each metric key.
 * Enforced so nonsensical combinations (e.g. AVG on scans where every value is 1)
 * are rejected at the domain level.
 */
export const VALID_METRIC_AGGREGATIONS: Readonly<
  Record<MetricKey, readonly AggregationFunction[]>
> = {
  'portal.scan': ['sum', 'count'],
  'portal.rating': ['count', 'max', 'avg'],
  'portal.qualified_scan': ['sum'],
  'portal.rating_count': ['sum'],
  'portal.rating_average': ['avg'],
  'portal.feedback': ['sum', 'count'],
  'portal.review_link_click': ['sum', 'count'],
  'property.review': ['count', 'avg', 'max'],
  'portal.content_review.completed': ['sum', 'count'],
  'portal.configuration_completeness': ['avg', 'max'],
  'portal.approved_destination_ratio': ['avg', 'max'],
}

/**
 * Default aggregation selected automatically per metric key in the create form.
 */
export const DEFAULT_AGGREGATION: Readonly<Record<MetricKey, AggregationFunction>> = {
  'portal.scan': 'sum',
  'portal.rating': 'avg',
  'portal.qualified_scan': 'sum',
  'portal.rating_count': 'sum',
  'portal.rating_average': 'avg',
  'portal.feedback': 'sum',
  'portal.review_link_click': 'sum',
  'property.review': 'avg',
  'portal.content_review.completed': 'sum',
  'portal.configuration_completeness': 'avg',
  'portal.approved_destination_ratio': 'avg',
}

// ── Validation helpers ───────────────────────────────────────────────────

export function isValidMetricKeyForScope(scope: EntityScope, key: MetricKey): boolean {
  return VALID_SCOPE_METRIC_KEYS[scope].includes(key)
}

export function isValidAggregationForMetric(
  key: MetricKey,
  agg: AggregationFunction,
): boolean {
  return VALID_METRIC_AGGREGATIONS[key].includes(agg)
}

export function getDefaultAggregation(key: MetricKey): AggregationFunction {
  return DEFAULT_AGGREGATION[key]
}
