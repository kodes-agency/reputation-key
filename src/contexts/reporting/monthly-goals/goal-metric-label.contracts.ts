// Shared measure labels for goal reads, forms and generated goal names.

import type { GoalMetric } from '../domain/goal-program'

const LABELS: Readonly<Record<GoalMetric, string>> = {
  qualified_scans: 'Scans',
  portal_rating_count: 'Private ratings',
  portal_rating_average: 'Average private rating',
}

export const goalMetricLabel = (metric: GoalMetric): string => LABELS[metric]
