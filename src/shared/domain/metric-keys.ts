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
  | 'portal.feedback'
  | 'portal.review_link_click'
  | 'property.review'

export type AggregationFunction = 'sum' | 'count' | 'max' | 'avg'

export type EntityScope = 'property' | 'portal_group' | 'portal'

// ── Constants ────────────────────────────────────────────────────────────

export const METRIC_KEYS: readonly MetricKey[] = [
  'portal.scan',
  'portal.rating',
  'portal.feedback',
  'portal.review_link_click',
  'property.review',
] as const

export const AGGREGATION_FUNCTIONS: readonly AggregationFunction[] = [
  'sum',
  'count',
  'max',
  'avg',
] as const

/**
 * Which metric keys are valid for each entity scope.
 * Portal group scope uses the same keys as portal scope — aggregated across member portals.
 */
export const VALID_SCOPE_METRIC_KEYS: Readonly<
  Record<EntityScope, readonly MetricKey[]>
> = {
  property: [...METRIC_KEYS],
  portal: ['portal.scan', 'portal.rating', 'portal.feedback', 'portal.review_link_click'],
  portal_group: [
    'portal.scan',
    'portal.rating',
    'portal.feedback',
    'portal.review_link_click',
  ],
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
  'portal.feedback': ['sum', 'count'],
  'portal.review_link_click': ['sum', 'count'],
  'property.review': ['sum', 'count'],
}

/**
 * Default aggregation selected automatically per metric key in the create form.
 */
export const DEFAULT_AGGREGATION: Readonly<Record<MetricKey, AggregationFunction>> = {
  'portal.scan': 'sum',
  'portal.rating': 'avg',
  'portal.feedback': 'sum',
  'portal.review_link_click': 'sum',
  'property.review': 'sum',
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
